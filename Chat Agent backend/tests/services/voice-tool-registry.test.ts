import * as registry from '../../src/services/voice-tool-registry';

// Mock the integrations layer so registry tests don't reach AWS/Eyefinity.
jest.mock('../../src/services/integrations', () => ({
  searchPatients: jest.fn().mockResolvedValue([{ id: 'p1', firstName: 'David', lastName: 'Walker' }]),
  getOffices: jest.fn().mockResolvedValue([{ id: 'o1', name: 'Main' }]),
  getProviders: jest.fn().mockResolvedValue([{ id: 'pr1', name: 'Dr. Smith' }]),
  getAvailableSlots: jest.fn().mockResolvedValue([{ time: '10:00' }]),
  bookAppointment: jest.fn().mockResolvedValue({ confirmation: 'ABC123' }),
  getPatientAppointments: jest.fn().mockResolvedValue([{ date: '2026-06-01' }]),
  sendSms: jest.fn().mockResolvedValue({ success: true, messageId: 'sm_1' }),
  redirectCallToOffice: jest.fn().mockResolvedValue({ success: true }),
}));

import * as integrations from '../../src/services/integrations';

const integrationsMock = integrations as jest.Mocked<typeof integrations>;

describe('voice-tool-registry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listSchemas', () => {
    it('returns all voice-safe tool schemas', () => {
      const schemas = registry.listSchemas();
      expect(schemas.length).toBeGreaterThan(0);
      const names = schemas.map((s) => s.name);
      expect(names).toContain('searchPatients');
      expect(names).toContain('bookAppointment');
      expect(names).toContain('sendSms');
    });

    it('schemas have name, description, and input_schema', () => {
      for (const s of registry.listSchemas()) {
        expect(typeof s.name).toBe('string');
        expect(typeof s.description).toBe('string');
        expect(s.input_schema.type).toBe('object');
      }
    });
  });

  describe('isAllowed', () => {
    it('allows known tools', () => {
      expect(registry.isAllowed('searchPatients')).toBe(true);
      expect(registry.isAllowed('bookAppointment')).toBe(true);
    });

    it('rejects unknown tools', () => {
      expect(registry.isAllowed('createPatient')).toBe(false);
      expect(registry.isAllowed('updateRx')).toBe(false);
      expect(registry.isAllowed('')).toBe(false);
    });
  });

  describe('execute', () => {
    const ctx = { tenantId: 'tenant-1' };

    it('dispatches searchPatients to integrations layer', async () => {
      const result = await registry.execute('searchPatients', { phone: '+15551234567' }, ctx);
      expect(result.success).toBe(true);
      expect(integrationsMock.searchPatients).toHaveBeenCalledWith('tenant-1', '+15551234567', undefined, undefined);
    });

    it('dispatches getOffices with no input', async () => {
      const result = await registry.execute('getOffices', {}, ctx);
      expect(result.success).toBe(true);
      expect(integrationsMock.getOffices).toHaveBeenCalledWith('tenant-1');
    });

    it('returns TOOL_NOT_ALLOWED for unknown tool', async () => {
      const result = await registry.execute('createPatient', {}, ctx);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('TOOL_NOT_ALLOWED');
    });

    it('returns TOOL_FAILED when downstream throws', async () => {
      integrationsMock.searchPatients.mockRejectedValueOnce(new Error('Eyefinity down'));
      const result = await registry.execute('searchPatients', { phone: '+15551234567' }, ctx);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('TOOL_FAILED');
      expect(result.error).toContain('Eyefinity down');
    });

    describe('caller-scope enforcement', () => {
      const scopedCtx = { tenantId: 'tenant-1', callerPatientId: 'patient-123' };

      it('allows bookAppointment when patientId matches caller', async () => {
        const result = await registry.execute(
          'bookAppointment',
          { officeId: 'o1', providerId: 'p1', date: '2026-06-01', time: '10:00', patientId: 'patient-123' },
          scopedCtx,
        );
        expect(result.success).toBe(true);
      });

      it('blocks bookAppointment when patientId mismatches caller', async () => {
        const result = await registry.execute(
          'bookAppointment',
          { officeId: 'o1', providerId: 'p1', date: '2026-06-01', time: '10:00', patientId: 'someone-else' },
          scopedCtx,
        );
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('CALLER_SCOPE_VIOLATION');
        expect(integrationsMock.bookAppointment).not.toHaveBeenCalled();
      });

      it('blocks getPatientAppointments when patientId mismatches caller', async () => {
        const result = await registry.execute(
          'getPatientAppointments',
          { patientId: 'someone-else' },
          scopedCtx,
        );
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('CALLER_SCOPE_VIOLATION');
      });

      it('does not enforce scope when callerPatientId is absent (anonymous caller)', async () => {
        const result = await registry.execute(
          'getPatientAppointments',
          { patientId: 'anyone' },
          { tenantId: 'tenant-1' },
        );
        expect(result.success).toBe(true);
      });
    });

    describe('transferToHuman (call-scope)', () => {
      it('appears in the schema list', () => {
        const names = registry.listSchemas().map((s) => s.name);
        expect(names).toContain('transferToHuman');
      });

      it('redirects the call when callSid is provided', async () => {
        const result = await registry.execute(
          'transferToHuman',
          { reason: 'caller wants billing' },
          { tenantId: 'tenant-1', callSid: 'CA1234' },
        );
        expect(result.success).toBe(true);
        expect(integrationsMock.redirectCallToOffice).toHaveBeenCalledWith('tenant-1', 'CA1234');
      });

      it('returns MISSING_CALL_SID when callSid is absent', async () => {
        const result = await registry.execute(
          'transferToHuman',
          { reason: 'human please' },
          { tenantId: 'tenant-1' },
        );
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('MISSING_CALL_SID');
        expect(integrationsMock.redirectCallToOffice).not.toHaveBeenCalled();
      });

      it('does not pass `reason` as spoken intro (LLM already announced transfer)', async () => {
        await registry.execute(
          'transferToHuman',
          { reason: 'something specific' },
          { tenantId: 'tenant-1', callSid: 'CA1' },
        );
        // Confirm reason was NOT passed as third positional arg (introMessage)
        expect(integrationsMock.redirectCallToOffice).toHaveBeenCalledWith('tenant-1', 'CA1');
      });
    });
  });
});
