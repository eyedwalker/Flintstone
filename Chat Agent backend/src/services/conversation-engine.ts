/**
 * Conversation Engine — channel-agnostic multi-turn conversation handler.
 *
 * Powers voice calls, SMS, and email conversations using the same core logic:
 *  1. Load/create session from DynamoDB
 *  2. Append user message
 *  3. Run sentiment analysis
 *  4. Call Claude Haiku via Bedrock InvokeModel (NOT InvokeAgent — too slow for voice)
 *  5. Detect and execute tool calls (same integrations.ts functions as Front Office agent)
 *  6. Save session
 *
 * Claude is called with Anthropic tool_use format for structured tool invocation.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as ddb from './dynamo';
import * as integrations from './integrations';
import * as securityAgent from './security-agent';

const REGION = process.env['REGION'] ?? 'us-west-2';
const VOICE_SESSIONS_TABLE = process.env['VOICE_SESSIONS_TABLE'] ?? 'chat-agent-voice-sessions-dev';
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const MAX_HISTORY_TURNS = 8; // Keep last 8 turns for context (16 messages)
const MAX_TURNS = 15;
const SESSION_TTL_HOURS = 2;

const bedrock = new BedrockRuntimeClient({ region: REGION });

// ── Session Types ─────────────────────────────────────────────────────────────

export type Channel = 'voice' | 'sms' | 'email';

export interface IConversationSession {
  id: string;
  tenantId: string;
  channel: Channel;
  fromPhone: string;
  toPhone?: string;
  startedAt: string;
  endedAt?: string;
  turns: number;
  history: IMessage[];
  patient?: {
    id: string;
    firstName: string;
    lastName: string;
    phone?: string;
    email?: string;
  };
  booking: {
    active: boolean;
    step: string | null;
    officeId?: string;
    providerId?: string;
  };
  sentiment: {
    overallScore: number;
    emotion: string;
    frustrationSignals: number;
    escalationNeeded: boolean;
  };
  escalationReason?: string;
  agentName: string;
  ttl: number;
}

export interface IMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: { tool: string; params: Record<string, string>; result: string }[];
}

export interface IConversationResult {
  response: string;
  shouldTransfer: boolean;
  shouldEndCall: boolean;
  toolsUsed: string[];
  sentiment: IConversationSession['sentiment'];
}

// ── Session Management ────────────────────────────────────────────────────────

export async function createSession(
  id: string,
  tenantId: string,
  channel: Channel,
  fromPhone: string,
  agentName?: string,
): Promise<IConversationSession> {
  const now = new Date();
  const session: IConversationSession = {
    id,
    tenantId,
    channel,
    fromPhone,
    startedAt: now.toISOString(),
    turns: 0,
    history: [],
    booking: { active: false, step: null },
    sentiment: { overallScore: 3, emotion: 'neutral', frustrationSignals: 0, escalationNeeded: false },
    agentName: agentName ?? 'Emily',
    ttl: Math.floor(now.getTime() / 1000) + SESSION_TTL_HOURS * 3600,
  };

  // Try patient lookup by phone
  try {
    const patients = await integrations.searchPatients(tenantId, fromPhone);
    if (patients.length === 1) {
      session.patient = patients[0];
    }
  } catch (err) {
    console.warn('[ConversationEngine] Patient lookup failed:', err);
  }

  await saveSession(session);
  return session;
}

export async function loadSession(id: string): Promise<IConversationSession | null> {
  return ddb.getItem<IConversationSession>(VOICE_SESSIONS_TABLE, { id });
}

export async function saveSession(session: IConversationSession): Promise<void> {
  await ddb.putItem(VOICE_SESSIONS_TABLE, session as unknown as Record<string, unknown>);
}

// ── Core Conversation Loop ────────────────────────────────────────────────────

/**
 * Process a user message and generate a response.
 * This is the main entry point — works for voice, SMS, and email.
 */
export async function processMessage(
  sessionId: string,
  userMessage: string,
  tenantId: string,
  channel: Channel,
  fromPhone: string,
  agentName?: string,
): Promise<IConversationResult> {
  // Load or create session
  let session = await loadSession(sessionId);
  if (!session) {
    session = await createSession(sessionId, tenantId, channel, fromPhone, agentName);
  }

  // Security scan
  const scan = securityAgent.scan(userMessage);
  if (!scan.allowed) {
    return {
      response: 'I\'m sorry, I couldn\'t process that. Could you please rephrase?',
      shouldTransfer: false,
      shouldEndCall: false,
      toolsUsed: [],
      sentiment: session.sentiment,
    };
  }

  // Add user message to history
  session.history.push({
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString(),
  });
  session.turns++;

  // Check for end-of-call intent
  if (shouldEndCall(userMessage)) {
    const farewell = `Thank you for calling${session.patient ? `, ${session.patient.firstName}` : ''}. Have a wonderful day!`;
    session.history.push({ role: 'assistant', content: farewell, timestamp: new Date().toISOString() });
    session.endedAt = new Date().toISOString();
    await saveSession(session);
    return {
      response: farewell,
      shouldTransfer: false,
      shouldEndCall: true,
      toolsUsed: [],
      sentiment: session.sentiment,
    };
  }

  // Update sentiment
  updateSentiment(session, userMessage);

  // Check for transfer intent or escalation
  if (shouldTransfer(userMessage) || session.sentiment.escalationNeeded) {
    session.escalationReason = session.sentiment.escalationNeeded
      ? 'Frustration detected'
      : 'Transfer requested by caller';
    await saveSession(session);
    return {
      response: 'Let me connect you with a team member who can help. One moment please.',
      shouldTransfer: true,
      shouldEndCall: false,
      toolsUsed: [],
      sentiment: session.sentiment,
    };
  }

  // Max turns protection
  if (session.turns >= MAX_TURNS) {
    await saveSession(session);
    return {
      response: 'I appreciate your patience. Let me connect you with a team member for further assistance.',
      shouldTransfer: true,
      shouldEndCall: false,
      toolsUsed: [],
      sentiment: session.sentiment,
    };
  }

  // Generate AI response with tool use
  const { response, toolsUsed } = await generateResponse(session, tenantId);

  // Add response to history
  session.history.push({
    role: 'assistant',
    content: response,
    timestamp: new Date().toISOString(),
    ...(toolsUsed.length > 0 && { toolCalls: toolsUsed.map(t => ({ tool: t, params: {}, result: '' })) }),
  });

  await saveSession(session);

  return {
    response,
    shouldTransfer: false,
    shouldEndCall: false,
    toolsUsed,
    sentiment: session.sentiment,
  };
}

// ── Claude LLM Invocation ─────────────────────────────────────────────────────

async function generateResponse(
  session: IConversationSession,
  tenantId: string,
): Promise<{ response: string; toolsUsed: string[] }> {
  const systemPrompt = buildSystemPrompt(session);
  const messages = buildMessages(session);
  const tools = buildToolDefinitions();

  try {
    // First call to Claude — may include tool_use
    const result = await callClaude(systemPrompt, messages, tools);

    // Check for tool calls
    const toolUseBlocks = result.content.filter((b: any) => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      // No tools — just text
      const textBlock = result.content.find((b: any) => b.type === 'text');
      return { response: textBlock?.text ?? 'I\'m here to help. What can I do for you?', toolsUsed: [] };
    }

    // Execute tools
    const toolsUsed: string[] = [];
    const toolResults: any[] = [];

    for (const toolBlock of toolUseBlocks) {
      const toolName = toolBlock.name;
      const toolInput = toolBlock.input ?? {};
      toolsUsed.push(toolName);

      console.log(`[ConversationEngine] Tool call: ${toolName}`, JSON.stringify(toolInput).slice(0, 200));

      const toolResult = await executeLocalTool(toolName, toolInput, tenantId);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: toolResult,
      });
    }

    // Second call to Claude with tool results
    const followUp = await callClaude(systemPrompt, [
      ...messages,
      { role: 'assistant', content: result.content },
      { role: 'user', content: toolResults },
    ], tools);

    const textBlock = followUp.content.find((b: any) => b.type === 'text');
    return {
      response: textBlock?.text ?? 'I found some information. How else can I help?',
      toolsUsed,
    };
  } catch (err) {
    console.error('[ConversationEngine] Claude error:', err);
    return {
      response: 'I apologize, I\'m having a bit of trouble right now. Could you try again?',
      toolsUsed: [],
    };
  }
}

async function callClaude(
  system: string,
  messages: any[],
  tools: any[],
): Promise<any> {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    system,
    messages,
    tools,
    max_tokens: 200,
    temperature: 0.7,
  };

  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  }));

  return JSON.parse(new TextDecoder().decode(res.body));
}

// ── Tool Definitions and Execution ────────────────────────────────────────────

function buildToolDefinitions(): any[] {
  return [
    {
      name: 'searchPatients',
      description: 'Search for a patient by phone number, name, date of birth, or email.',
      input_schema: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Patient phone number' },
          name: { type: 'string', description: 'Patient full name' },
          dob: { type: 'string', description: 'Date of birth YYYY-MM-DD' },
        },
      },
    },
    {
      name: 'getOffices',
      description: 'List available office locations.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'getProviders',
      description: 'List providers/doctors at an office.',
      input_schema: {
        type: 'object',
        properties: {
          officeId: { type: 'string', description: 'Office ID' },
        },
      },
    },
    {
      name: 'getAvailableSlots',
      description: 'Find open appointment slots at an office.',
      input_schema: {
        type: 'object',
        properties: {
          officeId: { type: 'string', description: 'Office ID' },
          providerId: { type: 'string', description: 'Provider ID (optional)' },
          date: { type: 'string', description: 'Date YYYY-MM-DD (defaults to today)' },
          preferredTime: { type: 'string', description: 'morning or afternoon' },
        },
        required: ['officeId'],
      },
    },
    {
      name: 'bookAppointment',
      description: 'Book an appointment. Always confirm details with the patient first.',
      input_schema: {
        type: 'object',
        properties: {
          officeId: { type: 'string' },
          providerId: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM or h:mm AM/PM' },
          patientId: { type: 'string', description: 'Patient ID (optional for new patients)' },
          type: { type: 'string', description: 'e.g., Eye Exam' },
        },
        required: ['officeId', 'providerId', 'date', 'time'],
      },
    },
    {
      name: 'sendSms',
      description: 'Send a text message to a phone number.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Phone number' },
          message: { type: 'string', description: 'Message text' },
        },
        required: ['to', 'message'],
      },
    },
    {
      name: 'getPatientAppointments',
      description: 'Get a patient\'s upcoming appointments.',
      input_schema: {
        type: 'object',
        properties: {
          patientId: { type: 'string' },
        },
        required: ['patientId'],
      },
    },
  ];
}

async function executeLocalTool(
  name: string,
  input: Record<string, any>,
  tenantId: string,
): Promise<string> {
  try {
    switch (name) {
      case 'searchPatients':
        return JSON.stringify(await integrations.searchPatients(tenantId, input.phone, input.name, input.dob));
      case 'getOffices':
        return JSON.stringify(await integrations.getOffices(tenantId));
      case 'getProviders':
        return JSON.stringify(await integrations.getProviders(tenantId, input.officeId));
      case 'getAvailableSlots':
        return JSON.stringify(await integrations.getAvailableSlots(tenantId, input.officeId, input.providerId, input.date, undefined, input.preferredTime));
      case 'bookAppointment':
        return JSON.stringify(await integrations.bookAppointment(tenantId, input as any));
      case 'sendSms':
        return JSON.stringify(await integrations.sendSms(tenantId, input.to, input.message));
      case 'getPatientAppointments':
        return JSON.stringify(await integrations.getPatientAppointments(tenantId, input.patientId));
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    console.error(`[ConversationEngine] Tool ${name} error:`, err);
    return JSON.stringify({ error: `Tool failed: ${String(err)}` });
  }
}

// ── System Prompt Builder ─────────────────────────────────────────────────────

function buildSystemPrompt(session: IConversationSession): string {
  const parts: string[] = [
    `You are ${session.agentName}, a friendly and professional AI receptionist for an eye care practice.`,
    '',
    'CRITICAL VOICE RULES:',
    '- Keep responses SHORT — 2-3 sentences maximum, under 15 seconds when spoken.',
    '- Output ONLY the words to be spoken. No stage directions, no asterisks, no emojis.',
    '- Be warm, natural, and conversational — like the best front desk receptionist.',
    '- NEVER reintroduce yourself after the first turn.',
    '- If unsure, ask a clarifying question rather than guessing.',
  ];

  if (session.patient) {
    parts.push('');
    parts.push(`PATIENT CONTEXT: You are speaking with ${session.patient.firstName} ${session.patient.lastName}.`);
    if (session.patient.phone) parts.push(`Phone: ${session.patient.phone}`);
    if (session.patient.id) parts.push(`Patient ID: ${session.patient.id}`);
  }

  parts.push('');
  parts.push('You can help with:');
  parts.push('- Scheduling, rescheduling, or checking appointments');
  parts.push('- Looking up patient information');
  parts.push('- Sending text messages or directions');
  parts.push('- Answering questions about office hours and locations');
  parts.push('- Connecting to a staff member if needed');

  return parts.join('\n');
}

function buildMessages(session: IConversationSession): any[] {
  // Take last N turns of history
  const recentHistory = session.history.slice(-MAX_HISTORY_TURNS * 2);

  return recentHistory.map((msg) => ({
    role: msg.role === 'system' ? 'user' : msg.role,
    content: msg.content,
  }));
}

// ── Sentiment Analysis ────────────────────────────────────────────────────────

const FRUSTRATION_WORDS = [
  'frustrated', 'angry', 'upset', 'ridiculous', 'unacceptable', 'terrible',
  'awful', 'horrible', 'worst', 'hate', 'stupid', 'incompetent', 'useless',
  'sick of', 'tired of', 'fed up', 'had enough', 'waste of time',
  'speak to someone', 'talk to a human', 'real person', 'manager',
  'supervisor', 'complaint', 'complain', 'unbelievable', 'pathetic',
];

function updateSentiment(session: IConversationSession, input: string): void {
  const lower = input.toLowerCase();
  let signals = 0;

  for (const word of FRUSTRATION_WORDS) {
    if (lower.includes(word)) signals++;
  }

  session.sentiment.frustrationSignals += signals;

  if (signals >= 2) {
    session.sentiment.emotion = 'angry';
    session.sentiment.overallScore = Math.max(1, session.sentiment.overallScore - 1.5);
  } else if (signals >= 1) {
    session.sentiment.emotion = 'frustrated';
    session.sentiment.overallScore = Math.max(1, session.sentiment.overallScore - 0.5);
  }

  if (session.sentiment.overallScore <= 1.5 || session.sentiment.frustrationSignals >= 3) {
    session.sentiment.escalationNeeded = true;
  }
}

// ── Intent Detection ──────────────────────────────────────────────────────────

function shouldEndCall(input: string): boolean {
  const lower = input.toLowerCase();
  const endPhrases = [
    'goodbye', 'bye', 'that\'s all', 'that\'s it', 'thanks bye',
    'thank you bye', 'no thanks', 'nothing else', 'i\'m good', 'hang up',
  ];
  return endPhrases.some((p) => lower.includes(p));
}

function shouldTransfer(input: string): boolean {
  const lower = input.toLowerCase();
  const transferPhrases = [
    'transfer me', 'connect me', 'speak to someone', 'talk to a person',
    'real person', 'human', 'operator', 'receptionist', 'manager',
  ];
  return transferPhrases.some((p) => lower.includes(p));
}
