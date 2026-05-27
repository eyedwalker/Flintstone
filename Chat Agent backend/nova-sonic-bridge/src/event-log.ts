/**
 * Event Log client — posts call lifecycle events back to the Chat Agent
 * backend so an admin UI can monitor calls in flight and so post-call
 * analysis has a structured record to work from.
 *
 * Calls are fire-and-forget: if the backend is briefly unreachable we log
 * and move on rather than blocking the audio path.
 */

const BACKEND_URL = process.env['CHAT_AGENT_BACKEND_URL'] ?? '';
const SERVICE_TOKEN = process.env['VOICE_GATEWAY_SERVICE_TOKEN'] ?? '';

export interface ICallStartEvent {
  callSid: string;
  tenantId: string;
  direction: 'inbound' | 'outbound';
  fromPhone?: string;
  toPhone?: string;
}

export async function startCall(e: ICallStartEvent): Promise<void> {
  await post({
    callSid: e.callSid,
    type: 'stream_started',
    start: true,
    tenantId: e.tenantId,
    direction: e.direction,
    fromPhone: e.fromPhone,
    toPhone: e.toPhone,
  });
}

export async function recordEvent(
  callSid: string,
  type: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await post({ callSid, type, data });
}

export async function recordPatientResolved(callSid: string, patientId: string): Promise<void> {
  await post({ callSid, type: 'patient_resolved', patientId, data: { patientId } });
}

export async function endCall(callSid: string, reason?: string): Promise<void> {
  await post({ callSid, type: 'end', data: reason ? { reason } : undefined });
}

async function post(body: Record<string, unknown>): Promise<void> {
  if (!BACKEND_URL || !SERVICE_TOKEN) return;
  try {
    const res = await fetch(`${BACKEND_URL}/voice/call-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[EventLog] backend rejected event: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn('[EventLog] post failed (continuing):', err);
  }
}
