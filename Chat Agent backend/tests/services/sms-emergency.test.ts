jest.mock('../../src/services/integrations', () => ({
  sendSms: jest.fn().mockResolvedValue({ success: true, messageId: 'sm_x' }),
  getOfficePhone: jest.fn().mockResolvedValue('+15806336937'),
}));

import { escalate, EMERGENCY_REPLY } from '../../src/services/sms-emergency';
import * as integrationsMod from '../../src/services/integrations';
import type { ISmsIntentResult } from '../../src/services/sms-intent';

const integrationsMock = integrationsMod as jest.Mocked<typeof integrationsMod>;

function makeIntent(): ISmsIntentResult {
  return {
    intent: 'emergency',
    confidence: 1.0,
    urgency: 'high',
    reasoning: 'mentioned chest pain',
    classifiedAt: '2026-05-27T10:00:00Z',
    modelId: 'test',
    isEmergency: true,
  };
}

describe('escalate', () => {
  beforeEach(() => {
    integrationsMock.sendSms.mockReset();
    integrationsMock.getOfficePhone.mockReset();
    integrationsMock.sendSms.mockResolvedValue({ success: true, messageId: 'sm_x' });
    integrationsMock.getOfficePhone.mockResolvedValue('+15806336937');
  });

  it('sends both the patient safe-harbor reply and the staff alert', async () => {
    const r = await escalate({
      tenantId: 't1',
      patientPhone: '+15551234567',
      messageBody: 'my chest is hurting bad',
      intent: makeIntent(),
    });
    expect(r.patientNotified).toBe(true);
    expect(r.staffNotified).toBe(true);
    expect(r.errors).toEqual([]);

    expect(integrationsMock.sendSms).toHaveBeenCalledTimes(2);
    const calls = integrationsMock.sendSms.mock.calls;
    // First call: patient reply
    expect(calls[0]![1]).toBe('+15551234567');
    expect(calls[0]![2]).toBe(EMERGENCY_REPLY);
    // Second call: staff
    expect(calls[1]![1]).toBe('+15806336937');
    expect(calls[1]![2]).toContain('URGENT');
    expect(calls[1]![2]).toContain('+15551234567');
    expect(calls[1]![2]).toContain('my chest is hurting bad');
  });

  it('truncates long messages to 100 chars in the staff alert', async () => {
    const longMsg = 'X'.repeat(500);
    await escalate({
      tenantId: 't1',
      patientPhone: '+15551234567',
      messageBody: longMsg,
      intent: makeIntent(),
    });
    const staffMsg = integrationsMock.sendSms.mock.calls[1]![2];
    // 97 chars + "..." = 100
    expect(staffMsg).toContain('X'.repeat(97) + '...');
    expect(staffMsg).not.toContain('X'.repeat(101));
  });

  it('records a partial failure when patient SMS bounces but staff still sent', async () => {
    integrationsMock.sendSms.mockResolvedValueOnce({ success: false, error: 'invalid number' });
    integrationsMock.sendSms.mockResolvedValueOnce({ success: true, messageId: 'sm_y' });
    const r = await escalate({
      tenantId: 't1',
      patientPhone: '+15551234567',
      messageBody: 'help',
      intent: makeIntent(),
    });
    expect(r.patientNotified).toBe(false);
    expect(r.staffNotified).toBe(true);
    expect(r.errors[0]).toContain('patient');
    expect(r.errors[0]).toContain('invalid number');
  });

  it('records an error when no office phone is configured', async () => {
    integrationsMock.getOfficePhone.mockResolvedValueOnce('');
    const r = await escalate({
      tenantId: 't1',
      patientPhone: '+15551234567',
      messageBody: 'help',
      intent: makeIntent(),
    });
    expect(r.staffNotified).toBe(false);
    expect(r.errors.some((e) => e.includes('no office phone'))).toBe(true);
    // Patient was still notified
    expect(r.patientNotified).toBe(true);
  });

  it('includes the classifier reasoning in the staff alert when present', async () => {
    await escalate({
      tenantId: 't1',
      patientPhone: '+15551234567',
      messageBody: 'help',
      intent: { ...makeIntent(), reasoning: 'reports severe eye pain' },
    });
    expect(integrationsMock.sendSms.mock.calls[1]![2]).toContain('reports severe eye pain');
  });

  it('does not throw even when both notifications fail', async () => {
    integrationsMock.sendSms.mockRejectedValue(new Error('twilio is down'));
    const r = await escalate({
      tenantId: 't1',
      patientPhone: '+15551234567',
      messageBody: 'help',
      intent: makeIntent(),
    });
    expect(r.patientNotified).toBe(false);
    expect(r.staffNotified).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
