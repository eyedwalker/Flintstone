/**
 * Transcribe Job Completion Handler
 *
 * EventBridge rule "Transcribe Job State Change" targets this Lambda. When
 * a job we started reaches COMPLETED (or FAILED), this fetches the result
 * from S3 and writes the transcript onto the call record, triggering a
 * fresh analyzer pass.
 *
 * Event shape:
 *   {
 *     "source": "aws.transcribe",
 *     "detail-type": "Transcribe Job State Change",
 *     "detail": {
 *       "TranscriptionJobName": "voice-CAxxx-1234567890",
 *       "TranscriptionJobStatus": "COMPLETED"
 *     }
 *   }
 *
 * Job names are namespaced with a `voice-` prefix in voice-transcription.ts —
 * we only handle our own jobs so non-voice Transcribe usage doesn't fire here
 * by accident.
 */

import * as transcription from './services/voice-transcription';
import * as callLog from './services/voice-call-log';

interface ITranscribeEvent {
  source?: string;
  'detail-type'?: string;
  detail?: {
    TranscriptionJobName?: string;
    TranscriptionJobStatus?: string;
  };
}

/**
 * Extract the callSid embedded in the job name.
 *   voice-CAabcdef123456-1234567890 → CAabcdef123456
 * The bridge's transcription kickoff replaces any chars not in [A-Za-z0-9_.-]
 * with `_` before constructing the name, so we round-trip safely.
 */
export function extractCallSidFromJobName(jobName: string): string | null {
  if (!jobName.startsWith('voice-')) return null;
  const rest = jobName.slice('voice-'.length);
  // Job name is voice-{callSid}-{epoch}; epoch is all digits at the end.
  const lastDash = rest.lastIndexOf('-');
  if (lastDash <= 0) return null;
  const sid = rest.slice(0, lastDash);
  const trailing = rest.slice(lastDash + 1);
  if (!/^\d+$/.test(trailing)) return null;
  return sid;
}

function transcriptS3Key(callSid: string): string {
  // Matches the layout from voice-transcription.ts
  return `voice-transcripts/${callSid}.json`;
}

export async function handler(event: ITranscribeEvent): Promise<{ ok: boolean; reason?: string }> {
  if (event.source !== 'aws.transcribe') return { ok: false, reason: 'wrong source' };
  if (event['detail-type'] !== 'Transcribe Job State Change') return { ok: false, reason: 'wrong detail-type' };

  const jobName = event.detail?.TranscriptionJobName ?? '';
  const status = event.detail?.TranscriptionJobStatus ?? '';

  const callSid = extractCallSidFromJobName(jobName);
  if (!callSid) {
    // Not one of our jobs — silently ignore so we don't pollute logs with
    // unrelated tenants' Transcribe activity in the same account.
    return { ok: false, reason: 'not a voice job' };
  }

  if (status === 'FAILED') {
    console.warn(`[Transcribe] job ${jobName} FAILED for ${callSid}`);
    await callLog.appendEvent(callSid, {
      type: 'transcription_failed',
      at: new Date().toISOString(),
      data: { jobName },
    });
    return { ok: true, reason: 'job failed; event recorded' };
  }

  if (status !== 'COMPLETED') {
    return { ok: false, reason: `ignoring status ${status}` };
  }

  const result = await transcription.applyTranscript({
    callSid,
    s3Key: transcriptS3Key(callSid),
  });

  if (!result.success) {
    console.error(`[Transcribe] applyTranscript failed for ${callSid}: ${result.error}`);
    return { ok: false, reason: result.error };
  }
  console.log(`[Transcribe] applied transcript for ${callSid}`);
  return { ok: true };
}
