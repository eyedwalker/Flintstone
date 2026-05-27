import { mockDynamoDB, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '../helpers/mock-aws';

const ddbMock = mockDynamoDB();

// Stub the transcription module so transcript-ready tests don't reach S3.
jest.mock('../../src/services/voice-transcription', () => ({
  kickoffTranscription: jest.fn().mockResolvedValue({ success: true, jobName: 'mock-job' }),
  applyTranscript: jest.fn().mockResolvedValue({ success: true }),
  extractTranscriptText: jest.fn(),
}));

// And the analyzer so recording-status doesn't try to call Bedrock.
jest.mock('../../src/services/voice-call-analyzer', () => ({
  analyzeCall: jest.fn().mockResolvedValue(null),
}));

// Stub integrations for the voicemail notification path.
jest.mock('../../src/services/integrations', () => ({
  getOfficePhone: jest.fn().mockResolvedValue('+15806336937'),
  sendSms: jest.fn().mockResolvedValue({ success: true, messageId: 'sm_1' }),
}));

import {
  handleCallEvent,
  handleActiveCalls,
  handleCallDetail,
  handleRecordingStatus,
  handleTranscriptReady,
} from '../../src/routes/voice';
import * as transcriptionMod from '../../src/services/voice-transcription';
import * as integrationsMod from '../../src/services/integrations';

const transcriptionMock = transcriptionMod as jest.Mocked<typeof transcriptionMod>;
const integrationsMock = integrationsMod as jest.Mocked<typeof integrationsMod>;

const VALID_TOKEN = 'test-token-9999999999';

function bearer(token: string): Record<string, string | undefined> {
  return { authorization: `Bearer ${token}` };
}

describe('voice monitoring endpoints', () => {
  const ORIGINAL_TOKEN = process.env['VOICE_GATEWAY_SERVICE_TOKEN'];

  beforeEach(() => {
    process.env['VOICE_GATEWAY_SERVICE_TOKEN'] = VALID_TOKEN;
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
  });

  afterAll(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env['VOICE_GATEWAY_SERVICE_TOKEN'];
    else process.env['VOICE_GATEWAY_SERVICE_TOKEN'] = ORIGINAL_TOKEN;
  });

  describe('handleCallEvent', () => {
    it('rejects without bearer', async () => {
      const r = await handleCallEvent({ callSid: 'CA1', type: 'foo' }, {}) as { statusCode: number };
      expect(r.statusCode).toBe(401);
    });

    it('rejects when callSid missing', async () => {
      const r = await handleCallEvent({ type: 'foo' }, bearer(VALID_TOKEN)) as { statusCode: number };
      expect(r.statusCode).toBe(400);
    });

    it('appends a plain event', async () => {
      const r = await handleCallEvent(
        { callSid: 'CA1', type: 'tool_use', data: { name: 'searchPatients' } },
        bearer(VALID_TOKEN),
      ) as { statusCode: number };
      expect(r.statusCode).toBe(200);
      // Only an UpdateCommand should fire (append), no Put
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('creates the call record when start:true', async () => {
      const r = await handleCallEvent(
        {
          callSid: 'CA1', type: 'stream_started', start: true,
          tenantId: 't1', direction: 'inbound', fromPhone: '+15551234567',
        },
        bearer(VALID_TOKEN),
      ) as { statusCode: number };
      expect(r.statusCode).toBe(200);
      // Put for the start, Update for the event append
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
      expect(ddbMock.commandCalls(UpdateCommand).length).toBeGreaterThanOrEqual(1);
    });

    it('ends the call when type is "end"', async () => {
      const r = await handleCallEvent(
        { callSid: 'CA1', type: 'end' },
        bearer(VALID_TOKEN),
      ) as { statusCode: number };
      expect(r.statusCode).toBe(200);
      // One update for appendEvent, one for endCall — both update the same record
      expect(ddbMock.commandCalls(UpdateCommand).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('handleActiveCalls', () => {
    it('returns active calls for the tenant', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { id: 'call:CA1', tenantId: 't1', status: 'active', startedAt: '2026-05-26T10:00:00Z' },
          { id: 'call:CA2', tenantId: 't1', status: 'ended',  startedAt: '2026-05-26T09:00:00Z' },
        ],
      });
      const r = await handleActiveCalls('t1') as { statusCode: number; body: string };
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.calls).toHaveLength(1);
      expect(body.calls[0].id).toBe('call:CA1');
    });

    it('400s when tenantId missing', async () => {
      const r = await handleActiveCalls('') as { statusCode: number };
      expect(r.statusCode).toBe(400);
    });
  });

  describe('handleCallDetail', () => {
    it('returns the call when tenant matches', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { id: 'call:CA1', tenantId: 't1', status: 'active', events: [{ type: 'foo', at: 'x' }] },
      });
      const r = await handleCallDetail('CA1', 't1') as { statusCode: number; body: string };
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.call.id).toBe('call:CA1');
    });

    it('404s for tenant mismatch (prevents tenant-A from reading tenant-B calls)', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { id: 'call:CA1', tenantId: 'other-tenant', status: 'active', events: [] } });
      const r = await handleCallDetail('CA1', 't1') as { statusCode: number };
      expect(r.statusCode).toBe(404);
    });

    it('404s when not found', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      const r = await handleCallDetail('CA9', 't1') as { statusCode: number };
      expect(r.statusCode).toBe(404);
    });
  });

  describe('handleRecordingStatus', () => {
    it('writes recording URL on completed status', async () => {
      const r = await handleRecordingStatus({
        CallSid: 'CA1',
        RecordingSid: 'RE123',
        RecordingStatus: 'completed',
        RecordingUrl: 'https://api.twilio.com/.../RE123',
        RecordingDuration: '95',
      }) as { statusCode: number };
      expect(r.statusCode).toBe(200);
      // Two updates: setRecording + appendEvent(recording_complete)
      expect(ddbMock.commandCalls(UpdateCommand).length).toBeGreaterThanOrEqual(2);
    });

    it('ignores non-completed statuses (in-progress / failed) but still acks', async () => {
      const r = await handleRecordingStatus({
        CallSid: 'CA1', RecordingStatus: 'in-progress', RecordingUrl: 'x',
      }) as { statusCode: number };
      expect(r.statusCode).toBe(200);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('ignores when CallSid is missing', async () => {
      const r = await handleRecordingStatus({
        RecordingStatus: 'completed', RecordingUrl: 'x',
      }) as { statusCode: number };
      expect(r.statusCode).toBe(200);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it('fires transcription kickoff when call record has a tenant', async () => {
      ddbMock.on(GetCommand).resolves({
        Item: { id: 'call:CA1', tenantId: 't1', status: 'active', events: [] },
      });
      transcriptionMock.kickoffTranscription.mockClear();
      const r = await handleRecordingStatus({
        CallSid: 'CA1',
        RecordingStatus: 'completed',
        RecordingUrl: 'https://api.twilio.com/.../RE1',
        RecordingSid: 'RE1',
      }) as { statusCode: number };
      expect(r.statusCode).toBe(200);
      // We need to wait a tick for the fire-and-forget chain to schedule.
      await new Promise((res) => setImmediate(res));
      expect(transcriptionMock.kickoffTranscription).toHaveBeenCalledWith(
        'CA1', 't1', 'https://api.twilio.com/.../RE1',
      );
    });

    it('skips transcription when no tenant on the call record', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      transcriptionMock.kickoffTranscription.mockClear();
      await handleRecordingStatus({
        CallSid: 'CA1',
        RecordingStatus: 'completed',
        RecordingUrl: 'https://api.twilio.com/.../RE1',
      });
      await new Promise((res) => setImmediate(res));
      expect(transcriptionMock.kickoffTranscription).not.toHaveBeenCalled();
    });

    describe('voicemail branch (type=voicemail query)', () => {
      it('notifies staff via SMS when voicemail recording completes', async () => {
        ddbMock.on(GetCommand).resolves({
          Item: { id: 'call:CA1', tenantId: 't1', status: 'active', fromPhone: '+15551234567', events: [] },
        });
        integrationsMock.sendSms.mockClear();
        integrationsMock.getOfficePhone.mockClear();

        const r = await handleRecordingStatus(
          {
            CallSid: 'CA1',
            RecordingStatus: 'completed',
            RecordingUrl: 'https://api.twilio.com/.../REvm',
            RecordingSid: 'REvm',
            RecordingDuration: '15',
          },
          { type: 'voicemail' },
        ) as { statusCode: number };
        expect(r.statusCode).toBe(200);

        await new Promise((res) => setImmediate(res));
        expect(integrationsMock.getOfficePhone).toHaveBeenCalledWith('t1');
        expect(integrationsMock.sendSms).toHaveBeenCalled();
        const [, toPhone, smsBody] = integrationsMock.sendSms.mock.calls[0]!;
        expect(toPhone).toBe('+15806336937');
        expect(smsBody).toContain('voicemail');
        expect(smsBody).toContain('+15551234567');
        expect(smsBody).toContain('15s');
        expect(smsBody).toContain('CA1');
      });

      it('does NOT notify staff for a regular call recording', async () => {
        ddbMock.on(GetCommand).resolves({
          Item: { id: 'call:CA1', tenantId: 't1', status: 'active', events: [] },
        });
        integrationsMock.sendSms.mockClear();
        await handleRecordingStatus(
          {
            CallSid: 'CA1',
            RecordingStatus: 'completed',
            RecordingUrl: 'https://api.twilio.com/.../RE1',
          },
          // no type=voicemail
        ) as { statusCode: number };
        await new Promise((res) => setImmediate(res));
        expect(integrationsMock.sendSms).not.toHaveBeenCalled();
      });

      it('still kicks off transcription for a voicemail (so transcript + summary land)', async () => {
        ddbMock.on(GetCommand).resolves({
          Item: { id: 'call:CA1', tenantId: 't1', status: 'active', events: [] },
        });
        transcriptionMock.kickoffTranscription.mockClear();
        await handleRecordingStatus(
          {
            CallSid: 'CA1',
            RecordingStatus: 'completed',
            RecordingUrl: 'https://api.twilio.com/.../REvm',
          },
          { type: 'voicemail' },
        );
        await new Promise((res) => setImmediate(res));
        expect(transcriptionMock.kickoffTranscription).toHaveBeenCalled();
      });
    });
  });

  describe('handleTranscriptReady', () => {
    it('rejects without bearer', async () => {
      const r = await handleTranscriptReady(
        { callSid: 'CA1', s3Key: 'voice-transcripts/CA1.json' },
        {},
      ) as { statusCode: number };
      expect(r.statusCode).toBe(401);
    });

    it('rejects when callSid missing', async () => {
      const r = await handleTranscriptReady(
        { s3Key: 'voice-transcripts/CA1.json' },
        bearer(VALID_TOKEN),
      ) as { statusCode: number };
      expect(r.statusCode).toBe(400);
    });

    it('rejects when both s3Key and transcriptText are missing', async () => {
      const r = await handleTranscriptReady(
        { callSid: 'CA1' },
        bearer(VALID_TOKEN),
      ) as { statusCode: number };
      expect(r.statusCode).toBe(400);
    });

    it('applies a transcript via s3Key', async () => {
      transcriptionMock.applyTranscript.mockResolvedValueOnce({ success: true });
      const r = await handleTranscriptReady(
        { callSid: 'CA1', s3Key: 'voice-transcripts/CA1.json' },
        bearer(VALID_TOKEN),
      ) as { statusCode: number; body: string };
      expect(r.statusCode).toBe(200);
      expect(transcriptionMock.applyTranscript).toHaveBeenCalledWith({
        callSid: 'CA1',
        s3Key: 'voice-transcripts/CA1.json',
        transcriptText: undefined,
      });
    });

    it('applies a transcript via literal transcriptText', async () => {
      transcriptionMock.applyTranscript.mockResolvedValueOnce({ success: true });
      const r = await handleTranscriptReady(
        { callSid: 'CA1', transcriptText: 'caller: hello\nassistant: hi' },
        bearer(VALID_TOKEN),
      ) as { statusCode: number };
      expect(r.statusCode).toBe(200);
    });

    it('returns 500 when applyTranscript fails', async () => {
      transcriptionMock.applyTranscript.mockResolvedValueOnce({ success: false, error: 'S3 read failed' });
      const r = await handleTranscriptReady(
        { callSid: 'CA1', s3Key: 'voice-transcripts/CA1.json' },
        bearer(VALID_TOKEN),
      ) as { statusCode: number };
      expect(r.statusCode).toBe(500);
    });
  });
});
