// Mock the integrations layer so we don't reach real APIs.
jest.mock('../../src/services/integrations', () => ({
  searchPatients: jest.fn().mockResolvedValue([{ id: 'p1' }]),
  getOffices: jest.fn().mockResolvedValue([]),
  getProviders: jest.fn().mockResolvedValue([]),
  getAvailableSlots: jest.fn().mockResolvedValue([]),
  bookAppointment: jest.fn().mockResolvedValue({}),
  getPatientAppointments: jest.fn().mockResolvedValue([]),
  sendSms: jest.fn().mockResolvedValue({ success: true }),
}));

import { handleToolSchemas, handleToolExecute } from '../../src/routes/voice';

const VALID_TOKEN = 'test-service-token-1234567890';

function bearer(token: string): Record<string, string | undefined> {
  return { authorization: `Bearer ${token}` };
}

describe('voice bridge endpoints', () => {
  const ORIGINAL_TOKEN = process.env['VOICE_GATEWAY_SERVICE_TOKEN'];

  beforeEach(() => {
    process.env['VOICE_GATEWAY_SERVICE_TOKEN'] = VALID_TOKEN;
  });

  afterAll(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env['VOICE_GATEWAY_SERVICE_TOKEN'];
    else process.env['VOICE_GATEWAY_SERVICE_TOKEN'] = ORIGINAL_TOKEN;
  });

  describe('handleToolSchemas', () => {
    it('returns schemas with valid bearer', async () => {
      const r = await handleToolSchemas(bearer(VALID_TOKEN)) as { statusCode: number; body: string };
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(Array.isArray(body.tools)).toBe(true);
      expect(body.tools.length).toBeGreaterThan(0);
    });

    it('rejects missing Authorization header', async () => {
      const r = await handleToolSchemas({}) as { statusCode: number; body: string };
      expect(r.statusCode).toBe(401);
    });

    it('rejects wrong bearer token', async () => {
      const r = await handleToolSchemas(bearer('wrong-token-of-same-len-1234')) as { statusCode: number };
      expect(r.statusCode).toBe(401);
    });

    it('rejects when env token is unset, even with any Bearer presented', async () => {
      delete process.env['VOICE_GATEWAY_SERVICE_TOKEN'];
      const r = await handleToolSchemas(bearer(VALID_TOKEN)) as { statusCode: number };
      expect(r.statusCode).toBe(401);
    });

    it('rejects non-Bearer Authorization scheme', async () => {
      const r = await handleToolSchemas({ authorization: `Basic ${VALID_TOKEN}` }) as { statusCode: number };
      expect(r.statusCode).toBe(401);
    });
  });

  describe('handleToolExecute', () => {
    const goodBody = {
      tool: 'getOffices',
      input: {},
      context: { tenantId: 'tenant-1' },
    };

    it('executes a valid call with valid bearer', async () => {
      const r = await handleToolExecute(goodBody, bearer(VALID_TOKEN)) as { statusCode: number; body: string };
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.success).toBe(true);
    });

    it('rejects missing bearer', async () => {
      const r = await handleToolExecute(goodBody, {}) as { statusCode: number };
      expect(r.statusCode).toBe(401);
    });

    it('returns 403 for denied tool name', async () => {
      const r = await handleToolExecute(
        { tool: 'createPatient', input: {}, context: { tenantId: 'tenant-1' } },
        bearer(VALID_TOKEN),
      ) as { statusCode: number; body: string };
      expect(r.statusCode).toBe(403);
      expect(JSON.parse(r.body).errorCode).toBe('TOOL_NOT_ALLOWED');
    });

    it('returns 400 when tool is missing', async () => {
      const r = await handleToolExecute(
        { input: {}, context: { tenantId: 'tenant-1' } },
        bearer(VALID_TOKEN),
      ) as { statusCode: number };
      expect(r.statusCode).toBe(400);
    });

    it('returns 400 when context.tenantId is missing', async () => {
      const r = await handleToolExecute(
        { tool: 'getOffices', input: {}, context: {} },
        bearer(VALID_TOKEN),
      ) as { statusCode: number };
      expect(r.statusCode).toBe(400);
    });

    it('returns 200 with success:false for caller-scope violation', async () => {
      const r = await handleToolExecute(
        {
          tool: 'getPatientAppointments',
          input: { patientId: 'wrong-patient' },
          context: { tenantId: 'tenant-1', callerPatientId: 'right-patient' },
        },
        bearer(VALID_TOKEN),
      ) as { statusCode: number; body: string };
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.success).toBe(false);
      expect(body.errorCode).toBe('CALLER_SCOPE_VIOLATION');
    });
  });
});
