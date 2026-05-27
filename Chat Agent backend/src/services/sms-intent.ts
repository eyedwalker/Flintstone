/**
 * SMS Intent Classifier — fast Claude Haiku call that buckets every inbound
 * SMS into a known intent before the full conversation engine runs.
 *
 * Why classify first?
 *   1. Safety: emergencies (chest pain, vision loss, suicidal language) need
 *      to bypass the LLM tool surface and trigger immediate human escalation.
 *      The conversation engine can hold its own on these, but the human-loop
 *      path needs to fire BEFORE we generate a reassuring chatbot answer.
 *   2. Cost: appointment confirmations + opt-outs + simple "thank you"
 *      replies don't need 7-tool Claude with full Eyefinity wiring. Cheap
 *      classification → template reply for trivial intents.
 *   3. Analytics: knowing intent distribution per tenant lights up the
 *      dashboard ("60% of inbound is appointment reminders") and lets us
 *      tune the bot.
 *
 * The classifier is its own service so handleSmsInbound stays a thin router
 * and so tests can mock the Bedrock call without touching the conversation
 * engine.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const REGION = process.env['REGION'] ?? 'us-west-2';
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const bedrock = new BedrockRuntimeClient({ region: REGION });

/**
 * Controlled intent vocabulary. Add to this carefully — every value here is
 * a stable identifier that dashboards, routing rules, and analytics may key
 * on. NEVER rename an existing value (it'd break historical metrics);
 * deprecate + add new instead.
 */
export const INTENTS = [
  'emergency',                  // medical urgency, suicidal, severe pain — escalate now
  'appointment-booking',        // wants to book or change an appointment
  'appointment-confirmation',   // confirming an existing appointment (yes/no reply)
  'appointment-cancellation',   // wants to cancel
  'prescription-refill',        // contacts/glasses Rx refill
  'prescription-question',      // wear schedule, medication, side effects
  'billing-question',           // insurance, invoice, payment
  'office-info',                // hours, location, directions
  'general-question',           // anything else conversational
  'spam',                       // promotional / off-topic / bot
] as const;

export type SmsIntent = typeof INTENTS[number];

export interface ISmsIntentResult {
  intent: SmsIntent;
  confidence: number;     // 0..1, model's self-reported confidence
  urgency: 'low' | 'medium' | 'high';
  reasoning?: string;     // one-sentence why (for logs, not for caller)
  classifiedAt: string;
  modelId: string;
  /** Whether the classifier detected emergency-grade urgency. Shortcut for routing. */
  isEmergency: boolean;
}

/** Hard keyword denylist that auto-classifies to emergency, even before calling Bedrock. */
const EMERGENCY_KEYWORDS = [
  'chest pain', 'heart attack', 'stroke', 'difficulty breathing', 'can\'t breathe',
  'suicide', 'suicidal', 'kill myself', 'end my life',
  'sudden vision loss', 'lost my vision', 'losing my sight', 'can\'t see',
  'severe eye pain', 'flashes and floaters', 'retinal detachment',
  'overdose', 'emergency', '911',
];

const SYSTEM_PROMPT = `You classify a single SMS message sent by a patient to an eye care office.
Return ONLY JSON in this exact shape, no prose:
{
  "intent": "emergency" | "appointment-booking" | "appointment-confirmation" | "appointment-cancellation" | "prescription-refill" | "prescription-question" | "billing-question" | "office-info" | "general-question" | "spam",
  "confidence": 0.0-1.0,
  "urgency": "low" | "medium" | "high",
  "reasoning": "one sentence"
}
Rules:
- "emergency" + urgency "high" for: severe pain, sudden vision loss, suicidal language, life-threatening symptoms, requests for 911.
- "appointment-confirmation" for: "yes", "confirmed", "I'll be there", "no can't make it".
- "spam" for: promotional content, random links, robocall-style messages.
- Pick the SINGLE best intent. If unclear, "general-question".
- Confidence reflects how sure you are. 0.5 means coin-flip.`;

/**
 * Pre-LLM keyword check for emergencies. Catches cases where the model might
 * misclassify or be down. Cheap, conservative — false positives only escalate
 * unnecessarily, never miss a real emergency.
 */
export function isObviousEmergency(message: string): boolean {
  const lower = message.toLowerCase();
  return EMERGENCY_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * Classify an inbound SMS. Never throws; on failure returns a "general-question"
 * fallback so the conversation can still flow through the regular path.
 */
export async function classify(message: string): Promise<ISmsIntentResult> {
  const now = new Date().toISOString();

  // Fast-path: keyword denylist beats the LLM round-trip.
  if (isObviousEmergency(message)) {
    return {
      intent: 'emergency',
      confidence: 1.0,
      urgency: 'high',
      reasoning: 'matched emergency keyword denylist',
      classifiedAt: now,
      modelId: 'keyword-rule',
      isEmergency: true,
    };
  }

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: message }],
  };

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: MODEL_ID,
      body: Buffer.from(JSON.stringify(body), 'utf-8'),
    }));
    const data = JSON.parse(Buffer.from(res.body).toString('utf-8')) as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text ?? '';
    const raw = extractJson(text);
    return normalize(raw, now);
  } catch (err) {
    console.error('[SmsIntent] Bedrock classification failed:', err);
    return fallback(now);
  }
}

function fallback(now: string): ISmsIntentResult {
  return {
    intent: 'general-question',
    confidence: 0.0,
    urgency: 'low',
    reasoning: 'classifier failed; fallback',
    classifiedAt: now,
    modelId: 'fallback',
    isEmergency: false,
  };
}

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`No JSON in classifier output: ${text.slice(0, 200)}`);
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalize(raw: Record<string, unknown>, now: string): ISmsIntentResult {
  const rawIntent = typeof raw['intent'] === 'string' ? raw['intent'] : '';
  const intent: SmsIntent = (INTENTS as readonly string[]).includes(rawIntent)
    ? (rawIntent as SmsIntent)
    : 'general-question';

  const confRaw = raw['confidence'];
  const confidence = typeof confRaw === 'number' && confRaw >= 0 && confRaw <= 1 ? confRaw : 0.5;

  const urgency = (['low', 'medium', 'high'] as const).find((u) => u === raw['urgency']) ?? 'low';
  const reasoning = typeof raw['reasoning'] === 'string' ? raw['reasoning'] : undefined;

  return {
    intent,
    confidence,
    urgency,
    reasoning,
    classifiedAt: now,
    modelId: MODEL_ID,
    isEmergency: intent === 'emergency' || urgency === 'high',
  };
}
