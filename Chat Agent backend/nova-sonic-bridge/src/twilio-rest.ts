/**
 * Minimal Twilio REST client for the bridge.
 *
 * Used to:
 *   • Start a recording on an in-progress call (POST /Calls/{Sid}/Recordings.json)
 *
 * Credentials come from the Chat Agent backend SSM parameter store — but the
 * bridge runs in a different process, so we expose them as env vars on the
 * Fargate task definition. The CloudFormation template ([nova-sonic-fargate.yaml])
 * pulls them from a SAM/Secrets Manager parameter set per tenant.
 *
 * Limitation: this scaffold supports a single tenant via env (TWILIO_ACCOUNT_SID
 * + TWILIO_AUTH_TOKEN). For multi-tenant, switch to fetching from the backend.
 */

const TWILIO_ACCOUNT_SID = process.env['TWILIO_ACCOUNT_SID'] ?? '';
const TWILIO_AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN'] ?? '';
const RECORDING_STATUS_CALLBACK = process.env['RECORDING_STATUS_CALLBACK'] ?? '';

export interface IStartRecordingResult {
  success: boolean;
  recordingSid?: string;
  error?: string;
}

/**
 * Start a recording on an in-progress Twilio call. The recording captures
 * both legs (caller + our Stream output) as a dual-channel WAV/MP3.
 * Twilio fires RECORDING_STATUS_CALLBACK when the recording completes.
 */
export async function startRecording(callSid: string): Promise<IStartRecordingResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { success: false, error: 'Twilio credentials not configured on bridge' };
  }
  if (!callSid) return { success: false, error: 'callSid required' };

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const params = new URLSearchParams({
    RecordingChannels: 'dual', // separate channels for caller vs assistant
    RecordingTrack: 'both',
  });
  if (RECORDING_STATUS_CALLBACK) {
    params.set('RecordingStatusCallback', RECORDING_STATUS_CALLBACK);
    params.set('RecordingStatusCallbackEvent', 'completed');
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}/Recordings.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
    );
    if (!res.ok) {
      return { success: false, error: `Twilio recording start failed: ${res.status} ${await res.text()}` };
    }
    const data = await res.json() as { sid?: string };
    return { success: true, recordingSid: data.sid };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
