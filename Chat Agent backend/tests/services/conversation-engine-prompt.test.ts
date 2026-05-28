import { buildSystemPrompt, IConversationSession, Channel } from '../../src/services/conversation-engine';

function makeSession(overrides: Partial<IConversationSession> = {}): IConversationSession {
  const base: IConversationSession = {
    id: 'test-1',
    tenantId: 'tenant-1',
    channel: 'voice',
    fromPhone: '+15551234567',
    startedAt: '2026-05-28T10:00:00Z',
    turns: 0,
    history: [],
    booking: { active: false, step: null },
    sentiment: { overallScore: 3, emotion: 'neutral', frustrationSignals: 0, escalationNeeded: false },
    agentName: 'Emily',
    ttl: 0,
  };
  return { ...base, ...overrides };
}

describe('buildSystemPrompt', () => {
  describe('channel-aware framing', () => {
    it('includes VOICE rules for voice channel only', () => {
      const p = buildSystemPrompt(makeSession({ channel: 'voice' }));
      expect(p).toContain('CRITICAL VOICE RULES');
      expect(p).toContain('under 15 seconds when spoken');
      expect(p).not.toContain('SMS RULES');
    });

    it('includes SMS rules for sms channel only — no voice rules', () => {
      const p = buildSystemPrompt(makeSession({ channel: 'sms' }));
      expect(p).toContain('SMS RULES');
      expect(p).toContain('320 characters');
      // The "under 15 seconds when spoken" instruction was hurting SMS
      // booking flows; verify it's gone for SMS.
      expect(p).not.toContain('CRITICAL VOICE RULES');
      expect(p).not.toContain('under 15 seconds when spoken');
    });

    it('falls back to a generic block for email/other channels', () => {
      const p = buildSystemPrompt(makeSession({ channel: 'email' as Channel }));
      expect(p).not.toContain('CRITICAL VOICE RULES');
      expect(p).not.toContain('SMS RULES');
      expect(p).toContain('Be clear, complete, and warm');
    });

    it('explicitly tells voice to read back booking confirmations', () => {
      // The voice booking gap was partly "confirmation gets truncated/skipped".
      // The prompt now nudges the model to always read it back.
      const p = buildSystemPrompt(makeSession({ channel: 'voice' }));
      expect(p).toMatch(/read back the full details/i);
      expect(p).toContain('confirmation number');
    });

    it('tells SMS to send confirmation in a single follow-up text', () => {
      const p = buildSystemPrompt(makeSession({ channel: 'sms' }));
      expect(p).toMatch(/confirmation details in a single follow-up text/i);
    });
  });

  describe('booking-flow guidance', () => {
    it('is present on every channel (booking is the highest-value flow)', () => {
      for (const ch of ['voice', 'sms', 'email'] as Channel[]) {
        const p = buildSystemPrompt(makeSession({ channel: ch }));
        expect(p).toContain('BOOKING FLOW');
        expect(p).toContain('getAvailableSlots');
        expect(p).toContain('bookAppointment');
      }
    });

    it('locks the 6-step booking script', () => {
      const p = buildSystemPrompt(makeSession({ channel: 'sms' }));
      // The script: office → provider → date/time → slots → pick → book → readback
      expect(p).toMatch(/1\. Confirm which office/);
      expect(p).toMatch(/2\. Ask which provider/);
      expect(p).toMatch(/3\. Ask preferred date/);
      expect(p).toMatch(/4\. Call getAvailableSlots/);
      expect(p).toMatch(/5\. .*bookAppointment/);
      expect(p).toMatch(/6\. .*read back/);
    });

    it('explicitly forbids making up slot times', () => {
      const p = buildSystemPrompt(makeSession({ channel: 'voice' }));
      expect(p).toContain('Never invent slot times');
    });

    it('requires getAvailableSlots before booking', () => {
      const p = buildSystemPrompt(makeSession({ channel: 'voice' }));
      expect(p).toContain('Never skip the getAvailableSlots step');
    });
  });

  describe('patient context injection', () => {
    it('greets the patient by name and exposes the patient id for tool calls', () => {
      const p = buildSystemPrompt(makeSession({
        channel: 'voice',
        patient: { id: 'P-1167233', firstName: 'David', lastName: 'Walker' },
      }));
      expect(p).toContain('David Walker');
      expect(p).toContain('Patient ID: P-1167233');
      expect(p).toContain('Use this Patient ID when calling bookAppointment');
    });

    it('omits patient context when the caller is unresolved', () => {
      const p = buildSystemPrompt(makeSession({ patient: undefined }));
      expect(p).not.toContain('PATIENT CONTEXT');
      expect(p).not.toContain('Patient ID:');
    });
  });

  describe('agent name', () => {
    it('uses whatever agentName the session carries', () => {
      const p = buildSystemPrompt(makeSession({ agentName: 'Olivia' }));
      expect(p).toContain('You are Olivia');
    });
  });
});
