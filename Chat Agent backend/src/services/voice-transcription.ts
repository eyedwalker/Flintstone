/**
 * Voice Transcription Pipeline
 *
 *   Twilio recording URL (Basic Auth)
 *        │
 *        ▼  download
 *   s3://chat-agent-hipaa-{stage}/voice-recordings/{tenantId}/{callSid}.mp3
 *        │
 *        ▼  StartTranscriptionJob
 *   Amazon Transcribe (async, ~recording duration)
 *        │
 *        ▼  writes JSON to
 *   s3://chat-agent-hipaa-{stage}/voice-transcripts/{callSid}.json
 *        │
 *        ▼  EventBridge "Transcribe Job State Change" event → Lambda
 *   POST /voice/transcript-ready {callSid, s3Key}
 *        │
 *        ▼
 *   applyTranscript() — save transcript text to call record + re-run analyzer
 *
 * The Lambda that handles the EventBridge event is not in this codebase yet
 * (separate workstream). For now /voice/transcript-ready can also be invoked
 * by any service-token holder, so a manual polling lambda or an external
 * webhook can deliver the transcript.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import * as ddb from './dynamo';
import * as callLog from './voice-call-log';
import * as callAnalyzer from './voice-call-analyzer';

const REGION = process.env['REGION'] ?? 'us-west-2';
const HIPAA_BUCKET = process.env['HIPAA_BUCKET'] ?? '';
const VOICE_SESSIONS_TABLE = process.env['VOICE_SESSIONS_TABLE'] ?? 'chat-agent-voice-sessions-dev';

const s3 = new S3Client({ region: REGION });
const transcribe = new TranscribeClient({ region: REGION });

const SSM_PREFIX = '/chat-agent';

function recordingObjectKey(tenantId: string, callSid: string): string {
  return `voice-recordings/${tenantId}/${callSid}.mp3`;
}

function transcriptObjectKey(callSid: string): string {
  return `voice-transcripts/${callSid}.json`;
}

function transcriptionJobName(callSid: string): string {
  // Transcribe job names must be unique account-wide; namespace by callSid.
  // Allowed chars: A-Z, a-z, 0-9, _, -, .
  const safe = callSid.replace(/[^A-Za-z0-9_.-]/g, '_');
  return `voice-${safe}-${Date.now()}`;
}

/**
 * Kick off async transcription for a completed Twilio recording.
 *   1. Download MP3 from Twilio (Basic Auth)
 *   2. Upload to S3 under voice-recordings/
 *   3. Start a Transcribe job that writes to voice-transcripts/
 *   4. Save the job name on the call record
 *
 * Fire-and-forget from the caller's perspective. Returns the job name on
 * success or an error string; never throws.
 */
export async function kickoffTranscription(
  callSid: string,
  tenantId: string,
  twilioRecordingUrl: string,
): Promise<{ success: boolean; jobName?: string; error?: string }> {
  if (!HIPAA_BUCKET) return { success: false, error: 'HIPAA_BUCKET not configured' };
  if (!callSid || !twilioRecordingUrl) return { success: false, error: 'callSid and recordingUrl required' };

  // Twilio recording URLs serve MP3 when you append .mp3
  const mp3Url = twilioRecordingUrl.endsWith('.mp3') ? twilioRecordingUrl : `${twilioRecordingUrl}.mp3`;

  // Twilio creds come from SSM, same path used by integrations.sendSms etc.
  // Inlined here (instead of importing integrations) to keep the cold-start
  // module graph small.
  let accountSid: string, authToken: string;
  try {
    const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
    const ssm = new SSMClient({ region: REGION });
    const [sidParam, tokenParam] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: `${SSM_PREFIX}/${tenantId}/twilio/account-sid`, WithDecryption: true })),
      ssm.send(new GetParameterCommand({ Name: `${SSM_PREFIX}/${tenantId}/twilio/auth-token`, WithDecryption: true })),
    ]);
    accountSid = sidParam.Parameter?.Value ?? '';
    authToken = tokenParam.Parameter?.Value ?? '';
  } catch (err) {
    return { success: false, error: `Twilio creds unavailable: ${String(err)}` };
  }
  if (!accountSid || !authToken) return { success: false, error: 'Twilio creds empty' };

  // 1. Download the MP3 from Twilio
  let mp3Buffer: Buffer;
  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await fetch(mp3Url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) return { success: false, error: `Twilio MP3 fetch ${res.status}: ${await res.text()}` };
    mp3Buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { success: false, error: `MP3 fetch failed: ${String(err)}` };
  }

  // 2. Upload to S3
  const recordingKey = recordingObjectKey(tenantId, callSid);
  try {
    await s3.send(new PutObjectCommand({
      Bucket: HIPAA_BUCKET,
      Key: recordingKey,
      Body: mp3Buffer,
      ContentType: 'audio/mpeg',
      ServerSideEncryption: 'AES256',
    }));
  } catch (err) {
    return { success: false, error: `S3 upload failed: ${String(err)}` };
  }

  // 3. Start Transcribe job
  const jobName = transcriptionJobName(callSid);
  const transcriptKey = transcriptObjectKey(callSid);
  try {
    await transcribe.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      MediaFormat: 'mp3',
      Media: { MediaFileUri: `s3://${HIPAA_BUCKET}/${recordingKey}` },
      OutputBucketName: HIPAA_BUCKET,
      OutputKey: transcriptKey,
      Settings: {
        // Dual-channel recording from Twilio means we can identify caller vs
        // assistant. The output JSON will include channel-separated transcripts.
        ChannelIdentification: true,
      },
    }));
  } catch (err) {
    return { success: false, error: `Transcribe start failed: ${String(err)}` };
  }

  // 4. Save job name + keys on the call record
  await ddb.updateItem(VOICE_SESSIONS_TABLE, { id: `call:${callSid}` }, {
    transcriptionJobName: jobName,
    recordingS3Key: recordingKey,
    transcriptS3Key: transcriptKey,
  });
  await callLog.appendEvent(callSid, {
    type: 'transcription_started',
    at: new Date().toISOString(),
    data: { jobName },
  });

  return { success: true, jobName };
}

/**
 * Apply a completed transcript: save the text on the call record and re-run
 * the analyzer (it'll prefer the transcript over the event log when present).
 *
 * Accepts either the raw transcript text, or an S3 key — in which case we
 * fetch and parse the Transcribe JSON output.
 */
export async function applyTranscript(input: {
  callSid: string;
  transcriptText?: string;
  s3Key?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { callSid } = input;
  if (!callSid) return { success: false, error: 'callSid required' };

  let text = input.transcriptText;

  if (!text && input.s3Key) {
    if (!HIPAA_BUCKET) return { success: false, error: 'HIPAA_BUCKET not configured' };
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: HIPAA_BUCKET, Key: input.s3Key }));
      const body = await res.Body?.transformToString();
      if (!body) return { success: false, error: 'Empty transcript object' };
      text = extractTranscriptText(body);
    } catch (err) {
      return { success: false, error: `Transcript fetch failed: ${String(err)}` };
    }
  }

  if (!text) return { success: false, error: 'No transcript text or s3Key provided' };

  await ddb.updateItem(VOICE_SESSIONS_TABLE, { id: `call:${callSid}` }, { transcript: text });
  await callLog.appendEvent(callSid, {
    type: 'transcript_ready',
    at: new Date().toISOString(),
    data: { length: text.length },
  });

  // Re-run analyzer with the richer input. Fire-and-forget — caller doesn't
  // need to wait for the Bedrock call.
  void callAnalyzer.analyzeCall(callSid).catch((err) => {
    console.error(`[Transcription] re-analyze failed for ${callSid}:`, err);
  });

  return { success: true };
}

/**
 * Parse Amazon Transcribe JSON output → plain text with speaker channels.
 *
 * Transcribe output shape (simplified):
 *   { results: { transcripts: [{ transcript: "..." }],
 *                channel_labels?: { channels: [{ channel_label, items }] } } }
 *
 * When channel_labels exist (ChannelIdentification: true), we render each
 * channel's text on its own line for the analyzer prompt.
 */
export function extractTranscriptText(json: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return ''; }
  if (!parsed || typeof parsed !== 'object') return '';
  const results = (parsed as Record<string, unknown>)['results'] as Record<string, unknown> | undefined;
  if (!results) return '';

  const channels = (results['channel_labels'] as Record<string, unknown> | undefined)?.['channels'];
  if (Array.isArray(channels) && channels.length > 0) {
    const lines: string[] = [];
    for (const ch of channels) {
      const c = ch as Record<string, unknown>;
      const label = c['channel_label'] === 'ch_1' ? 'caller'
        : c['channel_label'] === 'ch_0' ? 'assistant'
        : String(c['channel_label']);
      const items = c['items'] as Array<{ alternatives?: Array<{ content?: string }> }> | undefined;
      const words = (items ?? []).map((it) => it.alternatives?.[0]?.content ?? '').filter(Boolean);
      if (words.length) lines.push(`${label}: ${words.join(' ')}`);
    }
    if (lines.length) return lines.join('\n');
  }

  // Fall back to the unified transcript field.
  const transcripts = results['transcripts'];
  if (Array.isArray(transcripts) && transcripts.length > 0) {
    const t = transcripts[0] as { transcript?: string };
    return t.transcript ?? '';
  }
  return '';
}
