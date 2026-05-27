/**
 * Voice Call Analyzer — post-call summary, sentiment, and follow-ups.
 *
 * Fired when /voice/recording-status receives a `completed` callback from
 * Twilio. Given the call's event log + recording URL, we ask Claude Haiku
 * to extract a structured summary that staff can scan in seconds:
 *   • one-sentence summary
 *   • sentiment (positive / neutral / negative)
 *   • whether escalation/follow-up is needed
 *   • action items (book appt, send Rx info, etc.)
 *   • topics discussed (controlled vocabulary)
 *
 * Transcription from the recording is intentionally NOT included in v1.
 * The event log already has every tool call and assistant text-output;
 * for a Nova Sonic call that is a high-fidelity transcript without
 * needing to re-transcribe the audio. Recording is for compliance/audit
 * — full audio transcription can be added in a Phase 2 (Amazon Transcribe
 * batch job triggered separately).
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as callLog from './voice-call-log';
import * as ddb from './dynamo';
import * as metrics from './metrics';

const METRICS_NAMESPACE = 'VoiceBackend';

const REGION = process.env['REGION'] ?? 'us-west-2';
const VOICE_SESSIONS_TABLE = process.env['VOICE_SESSIONS_TABLE'] ?? 'chat-agent-voice-sessions-dev';
const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const bedrock = new BedrockRuntimeClient({ region: REGION });

export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface ICallAnalysis {
  summary: string;
  sentiment: Sentiment;
  followUpNeeded: boolean;
  actionItems: string[];
  topics: string[];
  analyzedAt: string;
  modelId: string;
}

/**
 * Build a compact "transcript" from the event log — useful even before audio
 * transcription is wired. Each event becomes a line: timestamp, type, salient fields.
 */
export function eventsToTranscript(events: callLog.ICallEvent[]): string {
  return events.map((e) => {
    const time = e.at.split('T')[1]?.slice(0, 8) ?? '?';
    if (e.type === 'tool_use') {
      const name = (e.data?.['name'] as string) ?? '?';
      return `[${time}] tool_use: ${name}`;
    }
    if (e.type === 'patient_resolved') {
      return `[${time}] patient_resolved: ${e.data?.['patientId'] ?? '?'}`;
    }
    if (e.type === 'recording_complete' || e.type === 'recording_started') return '';
    return `[${time}] ${e.type}${e.data ? ' ' + JSON.stringify(e.data) : ''}`;
  }).filter(Boolean).join('\n');
}

const SYSTEM_PROMPT = `You analyze a phone call between a patient and an AI voice receptionist for an eye care office.
You receive a structured event log of the call. Return ONLY a JSON object with this shape:
{
  "summary": "one sentence",
  "sentiment": "positive" | "neutral" | "negative",
  "followUpNeeded": boolean,
  "actionItems": ["..."],
  "topics": ["appointment-booking" | "appointment-confirmation" | "appointment-cancellation" | "prescription-question" | "billing-question" | "office-info" | "transfer-requested" | "other"]
}
No prose outside the JSON. Topics must come from the controlled list above.`;

export async function analyzeCall(callSid: string): Promise<ICallAnalysis | null> {
  const call = await callLog.getCall(callSid) as (callLog.ICallLogRecord & { transcript?: string }) | null;
  if (!call) {
    console.warn(`[Analyzer] No call record for ${callSid}`);
    return null;
  }

  const eventTranscript = eventsToTranscript(call.events ?? []);
  const audioTranscript = typeof call.transcript === 'string' ? call.transcript.trim() : '';
  const meta = [
    `direction: ${call.direction}`,
    call.fromPhone ? `fromPhone: ${call.fromPhone}` : '',
    call.toPhone ? `toPhone: ${call.toPhone}` : '',
    call.patientId ? `patientId: ${call.patientId}` : '',
    call.startedAt ? `startedAt: ${call.startedAt}` : '',
    call.endedAt ? `endedAt: ${call.endedAt}` : '',
  ].filter(Boolean).join('\n');

  // When an Amazon Transcribe transcript is available it's the higher-fidelity
  // source for caller speech (the event log captures assistant + tool actions
  // but not what the caller actually said word-for-word). Include both: the
  // transcript gives the words, the event log gives the actions.
  const sections = [`Call metadata:\n${meta}`];
  if (audioTranscript) sections.push(`Audio transcript (from Amazon Transcribe):\n${audioTranscript}`);
  sections.push(`Event log:\n${eventTranscript || '(no events recorded)'}`);
  const userContent = sections.join('\n\n');

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  };

  const dims = { TenantId: call.tenantId, Direction: call.direction };
  const startedAt = Date.now();

  let parsed: ICallAnalysis;
  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: MODEL_ID,
      body: Buffer.from(JSON.stringify(body), 'utf-8'),
    }));
    const data = JSON.parse(Buffer.from(res.body).toString('utf-8')) as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text ?? '';
    const json = extractJson(text);
    parsed = normalizeAnalysis(json);
  } catch (err) {
    console.error(`[Analyzer] Bedrock call failed for ${callSid}:`, err);
    metrics.emit({
      namespace: METRICS_NAMESPACE,
      dimensions: dims,
      values: { AnalyzeFailed: 1, AnalyzeLatencyMs: Date.now() - startedAt },
      units: { AnalyzeLatencyMs: 'Milliseconds' },
    });
    return null;
  }

  // Persist the analysis on the same call record.
  await ddb.updateItem(VOICE_SESSIONS_TABLE, { id: `call:${callSid}` }, { analysis: parsed });

  // Emit metrics so ops can chart sentiment distribution + analysis latency.
  metrics.emit({
    namespace: METRICS_NAMESPACE,
    dimensions: { ...dims, Sentiment: parsed.sentiment },
    values: {
      CallAnalyzed: 1,
      AnalyzeLatencyMs: Date.now() - startedAt,
      [`Sentiment_${parsed.sentiment}`]: 1,
      FollowUpNeeded: parsed.followUpNeeded ? 1 : 0,
      WithTranscript: audioTranscript ? 1 : 0,
    },
    units: { AnalyzeLatencyMs: 'Milliseconds' },
  });

  return parsed;
}

function extractJson(text: string): Record<string, unknown> {
  // Tolerate small framing variations — strip ``` fences or leading prose.
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`No JSON object in model output: ${text.slice(0, 200)}`);
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalizeAnalysis(raw: Record<string, unknown>): ICallAnalysis {
  const sentiment = (['positive', 'neutral', 'negative'] as const).find((s) => s === raw['sentiment']) ?? 'neutral';
  const summary = typeof raw['summary'] === 'string' ? raw['summary'] : 'No summary produced.';
  const followUpNeeded = raw['followUpNeeded'] === true;
  const actionItems = Array.isArray(raw['actionItems'])
    ? raw['actionItems'].filter((s): s is string => typeof s === 'string')
    : [];
  const topics = Array.isArray(raw['topics'])
    ? raw['topics'].filter((s): s is string => typeof s === 'string')
    : [];
  return {
    summary,
    sentiment,
    followUpNeeded,
    actionItems,
    topics,
    analyzedAt: new Date().toISOString(),
    modelId: MODEL_ID,
  };
}
