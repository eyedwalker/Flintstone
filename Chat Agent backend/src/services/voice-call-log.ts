/**
 * Voice Call Log — durable record of every voice call's lifecycle and events.
 *
 * Reuses VoiceSessionsTable with a `call:` key prefix so each call has a single
 * mutable record. Events are appended via DynamoDB list_append, which makes
 * concurrent writes from the bridge safe per-call.
 *
 * Data model:
 *   id           call:{callSid}
 *   tenantId     tenant the call belongs to
 *   status       'active' | 'ended' | 'recorded'
 *   fromPhone    caller's E.164 number
 *   toPhone      number called
 *   direction    'inbound' | 'outbound'
 *   startedAt    ISO timestamp
 *   endedAt      ISO timestamp (when status moves to ended)
 *   patientId    resolved on session start when search is unique
 *   recordingUrl set on /voice/recording-status webhook
 *   events       append-only list of { type, at, data? }
 *   ttl          90 days after endedAt — long enough for analysis, short enough to not pile up
 *   tenantId-index lookup is via the existing GSI
 */

import * as ddb from './dynamo';

const VOICE_SESSIONS_TABLE = process.env['VOICE_SESSIONS_TABLE'] ?? 'chat-agent-voice-sessions-dev';
const CALL_LOG_TTL_DAYS = 90;

export type CallStatus = 'active' | 'ended' | 'recorded';
export type CallDirection = 'inbound' | 'outbound';

export interface ICallEvent {
  type: string;
  at: string;
  data?: Record<string, unknown>;
}

export interface ICallLogRecord {
  id: string;
  tenantId: string;
  status: CallStatus;
  fromPhone?: string;
  toPhone?: string;
  direction: CallDirection;
  startedAt: string;
  endedAt?: string;
  patientId?: string;
  recordingUrl?: string;
  events: ICallEvent[];
  ttl?: number;
}

function key(callSid: string): { id: string } {
  return { id: `call:${callSid}` };
}

function ttlIn90Days(): number {
  return Math.floor(Date.now() / 1000) + CALL_LOG_TTL_DAYS * 24 * 3600;
}

export interface IStartCallInput {
  callSid: string;
  tenantId: string;
  direction: CallDirection;
  fromPhone?: string;
  toPhone?: string;
  startedAt?: string;
}

export async function startCall(input: IStartCallInput): Promise<void> {
  await ddb.putItem(VOICE_SESSIONS_TABLE, {
    id: `call:${input.callSid}`,
    tenantId: input.tenantId,
    direction: input.direction,
    fromPhone: input.fromPhone,
    toPhone: input.toPhone,
    status: 'active',
    startedAt: input.startedAt ?? new Date().toISOString(),
    events: [],
  });
}

export async function appendEvent(callSid: string, event: ICallEvent): Promise<void> {
  await ddb.appendListAttribute(
    VOICE_SESSIONS_TABLE,
    key(callSid),
    'events',
    [event],
  );
}

export async function setPatientId(callSid: string, patientId: string): Promise<void> {
  await ddb.updateItem(VOICE_SESSIONS_TABLE, key(callSid), { patientId });
}

export async function endCall(callSid: string): Promise<void> {
  await ddb.updateItem(VOICE_SESSIONS_TABLE, key(callSid), {
    status: 'ended',
    endedAt: new Date().toISOString(),
    ttl: ttlIn90Days(),
  });
}

export async function setRecording(callSid: string, recordingUrl: string, durationSec?: number): Promise<void> {
  await ddb.updateItem(VOICE_SESSIONS_TABLE, key(callSid), {
    recordingUrl,
    status: 'recorded',
    ...(durationSec !== undefined ? { recordingDurationSec: durationSec } : {}),
  });
}

export async function getCall(callSid: string): Promise<ICallLogRecord | null> {
  return ddb.getItem<ICallLogRecord>(VOICE_SESSIONS_TABLE, key(callSid));
}

/**
 * List active calls (status='active') for a tenant, sorted by start time desc.
 * Uses the tenantId-index GSI with a filter — fine at our expected volume
 * (low hundreds of active calls per tenant peak); switch to a status GSI if
 * concurrent volume goes higher.
 */
export async function listActiveCalls(tenantId: string, limit = 50): Promise<ICallLogRecord[]> {
  const items = await ddb.queryItems<ICallLogRecord>(
    VOICE_SESSIONS_TABLE,
    'tenantId = :t',
    { ':t': tenantId },
    undefined,
    'tenantId-index',
  );
  // Filter to call records (excludes session/optout records) and status=active.
  const active = items.filter((r) => r.id?.startsWith('call:') && r.status === 'active');
  active.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  return active.slice(0, limit);
}
