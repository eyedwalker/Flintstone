// Mock conversation-engine so we can assert which TwiML branch executed
// without reaching real DynamoDB / Bedrock.
jest.mock('../../src/services/conversation-engine', () => ({
  createSession: jest.fn().mockResolvedValue({
    id: 'call-1',
    agentName: 'Emily',
    patient: undefined,
    history: [],
  }),
  saveSession: jest.fn().mockResolvedValue(undefined),
  processMessage: jest.fn(),
  loadSession: jest.fn(),
}));

// Mock integrations to keep patient lookup off the wire.
jest.mock('../../src/services/integrations', () => ({
  searchPatients: jest.fn().mockResolvedValue([]),
  getOfficePhone: jest.fn().mockResolvedValue('+15551112222'),
  makeCall: jest.fn(),
  sendSms: jest.fn(),
}));

import { handleInboundCall } from '../../src/routes/voice';
import * as conversationEngine from '../../src/services/conversation-engine';

const conversationEngineMock = conversationEngine as jest.Mocked<typeof conversationEngine>;

describe('handleInboundCall — Nova Sonic streaming flag', () => {
  const STREAM_URL = 'wss://nova-sonic.example.com/stream';
  const ENABLED_NUMBER = '+15806336937';
  const NOT_ENABLED_NUMBER = '+15559998888';
  const baseUrl = 'https://example.com';

  const originalEnabledList = process.env['NOVA_SONIC_ENABLED_NUMBERS'];
  const originalStreamUrl = process.env['NOVA_SONIC_STREAM_URL'];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env['NOVA_SONIC_ENABLED_NUMBERS'] = ENABLED_NUMBER;
    process.env['NOVA_SONIC_STREAM_URL'] = STREAM_URL;
  });

  afterAll(() => {
    if (originalEnabledList === undefined) delete process.env['NOVA_SONIC_ENABLED_NUMBERS'];
    else process.env['NOVA_SONIC_ENABLED_NUMBERS'] = originalEnabledList;
    if (originalStreamUrl === undefined) delete process.env['NOVA_SONIC_STREAM_URL'];
    else process.env['NOVA_SONIC_STREAM_URL'] = originalStreamUrl;
  });

  it('returns Stream TwiML for enabled numbers and skips session creation', async () => {
    const r = await handleInboundCall(
      { CallSid: 'CA1', From: '+15551234567', To: ENABLED_NUMBER },
      baseUrl,
    ) as { statusCode: number; body: string };

    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<Connect>');
    expect(r.body).toContain('<Stream');
    expect(r.body).toContain(STREAM_URL);
    expect(r.body).toContain('<Parameter name="fromPhone" value="+15551234567"/>');
    expect(r.body).not.toContain('<Gather');
    // Critical: streamed calls don't create a DDB session — the bridge owns state.
    expect(conversationEngineMock.createSession).not.toHaveBeenCalled();
  });

  it('falls through to Say/Gather for non-enabled numbers', async () => {
    const r = await handleInboundCall(
      { CallSid: 'CA2', From: '+15551234567', To: NOT_ENABLED_NUMBER },
      baseUrl,
    ) as { statusCode: number; body: string };

    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<Gather');
    expect(r.body).not.toContain('<Connect>');
    expect(conversationEngineMock.createSession).toHaveBeenCalledTimes(1);
  });

  it('falls through to Say/Gather when NOVA_SONIC_STREAM_URL is unset (even if number is enabled)', async () => {
    delete process.env['NOVA_SONIC_STREAM_URL'];
    const r = await handleInboundCall(
      { CallSid: 'CA3', From: '+15551234567', To: ENABLED_NUMBER },
      baseUrl,
    ) as { statusCode: number; body: string };
    expect(r.body).toContain('<Gather');
    expect(r.body).not.toContain('<Connect>');
    expect(conversationEngineMock.createSession).toHaveBeenCalledTimes(1);
  });

  it('disables streaming entirely when the enabled list is empty', async () => {
    process.env['NOVA_SONIC_ENABLED_NUMBERS'] = '';
    const r = await handleInboundCall(
      { CallSid: 'CA4', From: '+15551234567', To: ENABLED_NUMBER },
      baseUrl,
    ) as { statusCode: number; body: string };
    expect(r.body).toContain('<Gather');
    expect(conversationEngineMock.createSession).toHaveBeenCalledTimes(1);
  });

  it('handles a multi-number list with whitespace correctly', async () => {
    process.env['NOVA_SONIC_ENABLED_NUMBERS'] = '+15551110000, +15806336937 ,+15557770000';
    const r = await handleInboundCall(
      { CallSid: 'CA5', From: '+15551234567', To: ENABLED_NUMBER },
      baseUrl,
    ) as { statusCode: number; body: string };
    expect(r.body).toContain('<Connect>');
    expect(conversationEngineMock.createSession).not.toHaveBeenCalled();
  });

  it('does not partial-match a prefix (safety: adding +1555 should not migrate +15551234567)', async () => {
    process.env['NOVA_SONIC_ENABLED_NUMBERS'] = '+1555';
    const r = await handleInboundCall(
      { CallSid: 'CA6', From: '+15551234567', To: '+15551234567' },
      baseUrl,
    ) as { statusCode: number; body: string };
    expect(r.body).toContain('<Gather');
    expect(r.body).not.toContain('<Connect>');
  });
});
