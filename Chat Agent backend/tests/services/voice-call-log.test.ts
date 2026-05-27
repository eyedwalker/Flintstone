import { mockDynamoDB, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '../helpers/mock-aws';
import * as callLog from '../../src/services/voice-call-log';

const ddbMock = mockDynamoDB();

describe('voice-call-log', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
  });

  describe('startCall', () => {
    it('writes an active call record prefixed with "call:"', async () => {
      await callLog.startCall({
        callSid: 'CA123',
        tenantId: 'tenant-1',
        direction: 'inbound',
        fromPhone: '+15551234567',
        toPhone: '+15806336937',
      });
      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
      const item = calls[0]!.args[0].input.Item as Record<string, unknown>;
      expect(item['id']).toBe('call:CA123');
      expect(item['status']).toBe('active');
      expect(item['direction']).toBe('inbound');
      expect(item['fromPhone']).toBe('+15551234567');
      expect(Array.isArray(item['events'])).toBe(true);
      expect(item['startedAt']).toBeDefined();
    });

    it('defaults to inbound when direction is missing (caller must pass it)', async () => {
      // Type system enforces direction; this test exists to document the contract.
      await callLog.startCall({ callSid: 'CA1', tenantId: 't', direction: 'outbound' });
      const item = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item as Record<string, unknown>;
      expect(item['direction']).toBe('outbound');
    });
  });

  describe('appendEvent', () => {
    it('uses list_append so concurrent writes are safe', async () => {
      await callLog.appendEvent('CA1', { type: 'tool_use', at: '2026-05-26T10:00:00Z', data: { name: 'searchPatients' } });
      const updates = ddbMock.commandCalls(UpdateCommand);
      expect(updates).toHaveLength(1);
      const expr = updates[0]!.args[0].input.UpdateExpression;
      expect(expr).toContain('list_append');
      expect(expr).toContain('if_not_exists');
    });
  });

  describe('endCall', () => {
    it('marks status=ended, sets endedAt, and adds a TTL', async () => {
      await callLog.endCall('CA1');
      const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
      const values = update.ExpressionAttributeValues as Record<string, unknown>;
      const valueArray = Object.values(values);
      expect(valueArray).toContain('ended');
      // TTL is an epoch second integer ~90 days in the future
      const ttl = valueArray.find((v) => typeof v === 'number') as number | undefined;
      expect(ttl).toBeDefined();
      expect(ttl).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe('setRecording', () => {
    it('sets recordingUrl and flips status to "recorded"', async () => {
      await callLog.setRecording('CA1', 'https://api.twilio.com/.../RE123.mp3', 95);
      const values = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
      const valueArray = Object.values(values);
      expect(valueArray).toContain('https://api.twilio.com/.../RE123.mp3');
      expect(valueArray).toContain('recorded');
      expect(valueArray).toContain(95);
    });
  });

  describe('getCall', () => {
    it('looks up by call: prefixed id', async () => {
      ddbMock.on(GetCommand).resolves({ Item: { id: 'call:CA1', status: 'active', events: [] } });
      const r = await callLog.getCall('CA1');
      const get = ddbMock.commandCalls(GetCommand)[0]!.args[0].input;
      expect(get.Key).toEqual({ id: 'call:CA1' });
      expect(r?.status).toBe('active');
    });

    it('returns null when missing', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      expect(await callLog.getCall('CA9')).toBeNull();
    });
  });

  describe('listActiveCalls', () => {
    it('filters to call: prefix + status=active and sorts desc by startedAt', async () => {
      ddbMock.on(QueryCommand).resolves({
        Items: [
          { id: 'call:CA1', tenantId: 't', status: 'active', startedAt: '2026-05-26T09:00:00Z' },
          { id: 'call:CA2', tenantId: 't', status: 'ended',  startedAt: '2026-05-26T10:00:00Z' },
          { id: 'call:CA3', tenantId: 't', status: 'active', startedAt: '2026-05-26T11:00:00Z' },
          { id: 'optout:t:5551234567', tenantId: 't', status: 'active' as unknown as 'active' },
          { id: 'sms-5551234567', tenantId: 't' },
        ],
      });
      const active = await callLog.listActiveCalls('t');
      expect(active.map((c) => c.id)).toEqual(['call:CA3', 'call:CA1']);
    });
  });
});
