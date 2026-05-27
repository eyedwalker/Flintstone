import { isObviousEmergency, classify, INTENTS } from '../../src/services/sms-intent';

// Bedrock client mock so we can shape model responses per test.
const sendMock = jest.fn();
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => sendMock(...args) })),
  InvokeModelCommand: jest.fn((args: Record<string, unknown>) => ({ input: args })),
}));

function mockBedrockJson(text: string): void {
  sendMock.mockResolvedValueOnce({
    body: Buffer.from(JSON.stringify({ content: [{ text }] }), 'utf-8'),
  });
}

describe('sms-intent', () => {
  beforeEach(() => sendMock.mockReset());

  describe('isObviousEmergency', () => {
    const cases = [
      'I have chest pain',
      'my chest hurts (CHEST PAIN really bad)',
      'sudden vision loss in my left eye',
      'I want to kill myself',
      'this is an emergency please call 911',
      'severe eye pain since this morning',
    ];

    for (const msg of cases) {
      it(`flags: ${msg.slice(0, 40)}...`, () => {
        expect(isObviousEmergency(msg)).toBe(true);
      });
    }

    it('does NOT flag a routine booking', () => {
      expect(isObviousEmergency('Can I book an appointment for next Tuesday?')).toBe(false);
    });

    it('does NOT flag a casual "no emergency" reply', () => {
      expect(isObviousEmergency('Nope, all good here')).toBe(false);
    });

    it('does NOT flag the word "pain" alone (only "chest pain" / "severe eye pain")', () => {
      expect(isObviousEmergency('my back is in pain after I tripped')).toBe(false);
    });
  });

  describe('classify', () => {
    it('short-circuits emergency keywords without calling Bedrock', async () => {
      const r = await classify('I have chest pain');
      expect(r.intent).toBe('emergency');
      expect(r.urgency).toBe('high');
      expect(r.isEmergency).toBe(true);
      expect(r.modelId).toBe('keyword-rule');
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('parses a clean classifier response', async () => {
      mockBedrockJson('{"intent": "appointment-booking", "confidence": 0.92, "urgency": "low", "reasoning": "asks to book"}');
      const r = await classify('Can I book an appointment for next Tuesday?');
      expect(r.intent).toBe('appointment-booking');
      expect(r.confidence).toBeCloseTo(0.92);
      expect(r.urgency).toBe('low');
      expect(r.isEmergency).toBe(false);
    });

    it('tolerates code-fenced JSON', async () => {
      mockBedrockJson('```json\n{"intent": "billing-question", "confidence": 0.8, "urgency": "low"}\n```');
      const r = await classify('Why did I get charged twice?');
      expect(r.intent).toBe('billing-question');
    });

    it('coerces unknown intent strings to general-question', async () => {
      mockBedrockJson('{"intent": "made-up-thing", "confidence": 0.9, "urgency": "low"}');
      const r = await classify('What time is it?');
      expect(r.intent).toBe('general-question');
    });

    it('treats LLM-flagged high urgency as emergency even without "emergency" intent', async () => {
      mockBedrockJson('{"intent": "prescription-question", "confidence": 0.7, "urgency": "high", "reasoning": "patient reports severe adverse reaction"}');
      const r = await classify('I think my new drops are causing serious problems');
      expect(r.isEmergency).toBe(true);
    });

    it('clamps invalid confidence to 0.5', async () => {
      mockBedrockJson('{"intent": "general-question", "confidence": 99, "urgency": "low"}');
      const r = await classify('hi');
      expect(r.confidence).toBe(0.5);
    });

    it('falls back gracefully when Bedrock throws', async () => {
      sendMock.mockRejectedValueOnce(new Error('bedrock down'));
      const r = await classify('hi');
      expect(r.intent).toBe('general-question');
      expect(r.modelId).toBe('fallback');
      expect(r.confidence).toBe(0.0);
      expect(r.isEmergency).toBe(false);
    });

    it('falls back when model returns non-JSON', async () => {
      mockBedrockJson('I think this is a booking request');
      const r = await classify('book me');
      expect(r.modelId).toBe('fallback');
    });
  });

  describe('INTENTS vocabulary', () => {
    it('includes the safety-critical intents', () => {
      expect(INTENTS).toContain('emergency');
      expect(INTENTS).toContain('appointment-booking');
      expect(INTENTS).toContain('spam');
    });
  });
});
