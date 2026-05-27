/**
 * SMS Opt-Out — TCPA-compliant STOP/START/HELP keyword handling.
 *
 * Stores opt-out records in the existing VoiceSessionsTable with a dedicated
 * `optout:` key prefix and no `ttl` attribute, so records persist indefinitely
 * (sessions in the same table have a 2-hour TTL — opt-outs must not).
 *
 * Twilio's documented stop/start/help keyword sets:
 *   https://help.twilio.com/articles/223134027
 */

import * as ddb from './dynamo';

const VOICE_SESSIONS_TABLE = process.env['VOICE_SESSIONS_TABLE'] ?? 'chat-agent-voice-sessions-dev';

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);
const HELP_KEYWORDS = new Set(['HELP', 'INFO']);

export type ComplianceKeyword = 'STOP' | 'START' | 'HELP';

export const STOP_REPLY =
  'You have been unsubscribed and will receive no further messages. Reply START to resubscribe.';
export const START_REPLY =
  'You are resubscribed. Msg & data rates may apply. Reply HELP for help, STOP to unsubscribe.';
export const HELP_REPLY =
  'Reply STOP to unsubscribe at any time. For support, please call our office.';

export function classifyKeyword(message: string): ComplianceKeyword | null {
  const upper = message.trim().toUpperCase();
  if (STOP_KEYWORDS.has(upper)) return 'STOP';
  if (START_KEYWORDS.has(upper)) return 'START';
  if (HELP_KEYWORDS.has(upper)) return 'HELP';
  return null;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function optOutKey(tenantId: string, phone: string): string {
  return `optout:${tenantId}:${normalizePhone(phone)}`;
}

interface OptOutRecord {
  id: string;
  tenantId: string;
  phone: string;
  optedOutAt: string;
}

export async function isOptedOut(tenantId: string, phone: string): Promise<boolean> {
  const record = await ddb.getItem<OptOutRecord>(VOICE_SESSIONS_TABLE, {
    id: optOutKey(tenantId, phone),
  });
  return record !== null;
}

export async function setOptOut(tenantId: string, phone: string): Promise<void> {
  await ddb.putItem(VOICE_SESSIONS_TABLE, {
    id: optOutKey(tenantId, phone),
    tenantId,
    phone,
    optedOutAt: new Date().toISOString(),
  });
}

export async function clearOptOut(tenantId: string, phone: string): Promise<void> {
  await ddb.deleteItem(VOICE_SESSIONS_TABLE, { id: optOutKey(tenantId, phone) });
}
