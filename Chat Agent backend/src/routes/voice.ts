/**
 * Voice & SMS Webhook Routes — handles Twilio callbacks for multi-turn conversations.
 *
 * Endpoints (no JWT auth — Twilio signature validated instead):
 *   POST /voice/inbound     — incoming call, return greeting TwiML
 *   POST /voice/respond     — speech captured, process and return next TwiML
 *   GET  /voice/outbound-twiml — TwiML for outbound calls
 *   POST /voice/sms-inbound — incoming SMS, process and reply
 *   POST /voice/status      — call status callback (recording, completion)
 *
 * Authenticated endpoint:
 *   POST /voice/outbound    — initiate an outbound call (admin/editor only)
 */

import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as conversationEngine from '../services/conversation-engine';
import * as twiml from '../services/voice-twiml';
import * as integrations from '../services/integrations';
import { parseBody } from '../auth';

const DEFAULT_TENANT_ID = process.env['DEFAULT_VOICE_TENANT_ID'] ?? '58b19370-10a1-70b9-584d-f14f731f6963';
const DEFAULT_AGENT_NAME = 'Emily';

function twimlResponse(xml: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: xml,
  };
}

function jsonResponse(data: unknown, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data),
  };
}

// ── Inbound Call ──────────────────────────────────────────────────────────────

/**
 * POST /voice/inbound — Twilio "A Call Comes In" webhook.
 * Creates a session and returns a greeting with Gather.
 */
export async function handleInboundCall(
  body: Record<string, string>,
  baseUrl: string,
): Promise<APIGatewayProxyResultV2> {
  const callSid = body['CallSid'] ?? uuidv4();
  const fromPhone = body['From'] ?? '';
  const toPhone = body['To'] ?? '';

  console.log(`[Voice] Inbound call: ${fromPhone} → ${toPhone} (${callSid})`);

  // Create session with patient lookup
  const session = await conversationEngine.createSession(
    callSid,
    DEFAULT_TENANT_ID,
    'voice',
    fromPhone,
    DEFAULT_AGENT_NAME,
  );

  // Build greeting
  const timeGreeting = twiml.getTimeGreeting();
  const patientName = session.patient ? `, ${session.patient.firstName}` : '';
  const greeting = `${timeGreeting}${patientName}! Thank you for calling. This is ${session.agentName}. How can I help you today?`;

  // Add greeting to history
  session.history.push({
    role: 'assistant',
    content: greeting,
    timestamp: new Date().toISOString(),
  });
  await conversationEngine.saveSession(session);

  const callbackUrl = `${baseUrl}/voice/respond`;
  return twimlResponse(twiml.buildGreetingTwiml(greeting, callbackUrl));
}

// ── Conversation Turn ─────────────────────────────────────────────────────────

/**
 * POST /voice/respond — Twilio Gather callback.
 * Processes speech input and returns next TwiML.
 */
export async function handleVoiceRespond(
  body: Record<string, string>,
  baseUrl: string,
): Promise<APIGatewayProxyResultV2> {
  const callSid = body['CallSid'] ?? '';
  const speechResult = body['SpeechResult'] ?? '';
  const digits = body['Digits'] ?? '';
  const fromPhone = body['From'] ?? '';

  console.log(`[Voice] Turn: "${speechResult || digits}" (${callSid})`);

  // Handle DTMF: 0 = transfer
  if (digits === '0') {
    const officePhone = '+15806336937'; // TODO: from tenant settings
    return twimlResponse(twiml.buildTransferTwiml(
      'Let me connect you with a team member. One moment please.',
      officePhone,
    ));
  }

  const userInput = speechResult || digits || '[no speech detected]';

  const result = await conversationEngine.processMessage(
    callSid,
    userInput,
    DEFAULT_TENANT_ID,
    'voice',
    fromPhone,
    DEFAULT_AGENT_NAME,
  );

  // Handle outcomes
  if (result.shouldEndCall) {
    return twimlResponse(twiml.buildHangupTwiml(result.response));
  }

  if (result.shouldTransfer) {
    const officePhone = '+15806336937'; // TODO: from tenant settings
    return twimlResponse(twiml.buildTransferTwiml(result.response, officePhone));
  }

  const callbackUrl = `${baseUrl}/voice/respond`;
  return twimlResponse(twiml.buildGatherTwiml(result.response, callbackUrl));
}

// ── Outbound Call TwiML ───────────────────────────────────────────────────────

/**
 * GET /voice/outbound-twiml — TwiML for outbound calls.
 * Twilio fetches this URL when the outbound call connects.
 */
export async function handleOutboundTwiml(
  query: Record<string, string>,
  baseUrl: string,
): Promise<APIGatewayProxyResultV2> {
  const message = query['message'] ?? 'Hello, this is a call from your eye care office.';
  const callSid = query['callSid'] ?? uuidv4();

  // Create session for the outbound call
  const toPhone = query['to'] ?? '';
  await conversationEngine.createSession(
    callSid,
    DEFAULT_TENANT_ID,
    'voice',
    toPhone,
    DEFAULT_AGENT_NAME,
  );

  const callbackUrl = `${baseUrl}/voice/respond`;
  return twimlResponse(twiml.buildGreetingTwiml(message, callbackUrl));
}

// ── Outbound Call Initiation ──────────────────────────────────────────────────

/**
 * POST /voice/outbound — Initiate an outbound call (authenticated).
 */
export async function handleOutboundCall(
  body: Record<string, unknown>,
): Promise<APIGatewayProxyResultV2> {
  const b = parseBody<{
    to: string;
    message: string;
    voiceName?: string;
  }>(JSON.stringify(body));

  if (!b?.to || !b?.message) {
    return jsonResponse({ error: 'to and message are required' }, 400);
  }

  // For conversational outbound calls, use Twilio API with TwiML URL
  // The TwiML URL will start the multi-turn conversation
  const result = await integrations.makeCall(DEFAULT_TENANT_ID, b.to, b.message, b.voiceName);
  return jsonResponse(result);
}

// ── SMS Inbound ───────────────────────────────────────────────────────────────

/**
 * POST /voice/sms-inbound — Twilio SMS webhook.
 * Processes incoming SMS and replies using the same conversation engine.
 */
export async function handleSmsInbound(
  body: Record<string, string>,
): Promise<APIGatewayProxyResultV2> {
  const fromPhone = body['From'] ?? '';
  const messageBody = body['Body'] ?? '';
  const messageSid = body['MessageSid'] ?? '';

  console.log(`[SMS] Inbound: "${messageBody}" from ${fromPhone}`);

  if (!messageBody.trim()) {
    return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }

  // SMS sessions are keyed by phone number (persistent across messages)
  const sessionId = `sms-${fromPhone.replace(/\D/g, '')}`;

  const result = await conversationEngine.processMessage(
    sessionId,
    messageBody,
    DEFAULT_TENANT_ID,
    'sms',
    fromPhone,
    DEFAULT_AGENT_NAME,
  );

  // Reply via TwiML <Message>
  const escaped = result.response
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return twimlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
  );
}

// ── Call Status Callback ──────────────────────────────────────────────────────

/**
 * POST /voice/status — Twilio call status webhook.
 */
export async function handleCallStatus(
  body: Record<string, string>,
): Promise<APIGatewayProxyResultV2> {
  const callSid = body['CallSid'] ?? '';
  const status = body['CallStatus'] ?? '';
  const duration = body['CallDuration'] ?? '';

  console.log(`[Voice] Status: ${callSid} → ${status} (${duration}s)`);

  // Mark session as ended if call is complete
  if (['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(status)) {
    const session = await conversationEngine.loadSession(callSid);
    if (session && !session.endedAt) {
      session.endedAt = new Date().toISOString();
      await conversationEngine.saveSession(session);
    }
  }

  return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>');
}
