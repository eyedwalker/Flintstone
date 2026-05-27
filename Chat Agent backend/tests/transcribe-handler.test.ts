// Stub the transcription module so we can assert applyTranscript was invoked
// without touching S3.
jest.mock('../src/services/voice-transcription', () => ({
  applyTranscript: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../src/services/voice-call-log', () => ({
  appendEvent: jest.fn().mockResolvedValue(undefined),
}));

import { handler, extractCallSidFromJobName } from '../src/transcribe-handler';
import * as transcriptionMod from '../src/services/voice-transcription';
import * as callLogMod from '../src/services/voice-call-log';

const transcriptionMock = transcriptionMod as jest.Mocked<typeof transcriptionMod>;
const callLogMock = callLogMod as jest.Mocked<typeof callLogMod>;

describe('extractCallSidFromJobName', () => {
  it('parses a typical job name', () => {
    expect(extractCallSidFromJobName('voice-CAabcdef12345-1700000000000'))
      .toBe('CAabcdef12345');
  });

  it('rejects names without the voice- prefix', () => {
    expect(extractCallSidFromJobName('other-job-name-1234')).toBeNull();
  });

  it('rejects names without a trailing epoch', () => {
    expect(extractCallSidFromJobName('voice-CAabc-notanumber')).toBeNull();
  });

  it('rejects names with no dash after the prefix', () => {
    expect(extractCallSidFromJobName('voice-CAabc')).toBeNull();
  });

  it('preserves underscores in callSid (Twilio uses them in sandbox sids)', () => {
    expect(extractCallSidFromJobName('voice-CA_abc_123-1700000000000')).toBe('CA_abc_123');
  });
});

describe('handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores non-Transcribe events', async () => {
    const r = await handler({ source: 'aws.other' });
    expect(r.ok).toBe(false);
    expect(transcriptionMock.applyTranscript).not.toHaveBeenCalled();
  });

  it('ignores wrong detail-type', async () => {
    const r = await handler({ source: 'aws.transcribe', 'detail-type': 'Something Else' });
    expect(r.ok).toBe(false);
  });

  it('ignores jobs not named voice-*', async () => {
    const r = await handler({
      source: 'aws.transcribe',
      'detail-type': 'Transcribe Job State Change',
      detail: { TranscriptionJobName: 'other-system-job-1', TranscriptionJobStatus: 'COMPLETED' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not a voice job');
    expect(transcriptionMock.applyTranscript).not.toHaveBeenCalled();
  });

  it('applies the transcript on COMPLETED events', async () => {
    const r = await handler({
      source: 'aws.transcribe',
      'detail-type': 'Transcribe Job State Change',
      detail: { TranscriptionJobName: 'voice-CA1-1700000000000', TranscriptionJobStatus: 'COMPLETED' },
    });
    expect(r.ok).toBe(true);
    expect(transcriptionMock.applyTranscript).toHaveBeenCalledWith({
      callSid: 'CA1',
      s3Key: 'voice-transcripts/CA1.json',
    });
  });

  it('records a transcription_failed event when status=FAILED (and does not apply transcript)', async () => {
    const r = await handler({
      source: 'aws.transcribe',
      'detail-type': 'Transcribe Job State Change',
      detail: { TranscriptionJobName: 'voice-CA2-1700000000000', TranscriptionJobStatus: 'FAILED' },
    });
    expect(r.ok).toBe(true);
    expect(callLogMock.appendEvent).toHaveBeenCalledWith('CA2', expect.objectContaining({
      type: 'transcription_failed',
    }));
    expect(transcriptionMock.applyTranscript).not.toHaveBeenCalled();
  });

  it('returns ok:false if applyTranscript fails', async () => {
    transcriptionMock.applyTranscript.mockResolvedValueOnce({ success: false, error: 'S3 read failed' });
    const r = await handler({
      source: 'aws.transcribe',
      'detail-type': 'Transcribe Job State Change',
      detail: { TranscriptionJobName: 'voice-CA3-1700000000000', TranscriptionJobStatus: 'COMPLETED' },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('S3 read failed');
  });
});
