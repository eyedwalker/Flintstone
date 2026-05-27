import { buildSystemPrompt } from '../src/prompt';

describe('buildSystemPrompt', () => {
  it('contains the base instructions', () => {
    const p = buildSystemPrompt(undefined, undefined);
    expect(p).toContain('Emily');
    expect(p).toContain('phone');
    expect(p).toContain('transferToHuman');
  });

  it('greets a resolved patient by first name and locks scope to their id', () => {
    const p = buildSystemPrompt(
      { id: '1167233', firstName: 'David', lastName: 'Walker' },
      '+15551234567',
    );
    expect(p).toContain('David Walker');
    expect(p).toContain('1167233');
    expect(p).toContain('Greet them by their first name');
  });

  it('warns the model to verify identity when patient is not resolved but phone is known', () => {
    const p = buildSystemPrompt(undefined, '+15551234567');
    expect(p).toContain('+15551234567');
    expect(p).toContain('did not return a unique match');
    expect(p).toContain('verify name and date of birth');
  });

  it('omits identity language entirely when caller is anonymous', () => {
    const p = buildSystemPrompt(undefined, undefined);
    expect(p).not.toContain('+');
    expect(p).not.toContain('did not return');
  });

  it('handles a patient with only first name (lastName missing)', () => {
    const p = buildSystemPrompt({ id: 'p1', firstName: 'Alex' }, '+15550000000');
    expect(p).toContain('Alex');
    expect(p).not.toMatch(/Alex\s+undefined/);
  });

  it('includes a time-of-day context line for scheduling', () => {
    const p = buildSystemPrompt(undefined, undefined);
    expect(p).toMatch(/(morning|afternoon|evening)/);
    expect(p).toMatch(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
  });

  describe('outbound calls', () => {
    it('marks the call as OUTBOUND in the prompt', () => {
      const p = buildSystemPrompt(undefined, '+15551234567', { direction: 'outbound' });
      expect(p).toContain('OUTBOUND');
      expect(p).toContain('we placed the call');
    });

    it('includes the goal verbatim when provided', () => {
      const p = buildSystemPrompt(undefined, '+1', {
        direction: 'outbound',
        goal: 'Confirm Tuesday 2pm appointment',
      });
      expect(p).toContain('Confirm Tuesday 2pm appointment');
      expect(p).toContain('Purpose of this call');
    });

    it('changes "Greet them" to "Address them" for outbound with a known patient', () => {
      const inbound = buildSystemPrompt({ id: 'p1', firstName: 'David' }, '+1');
      const outbound = buildSystemPrompt({ id: 'p1', firstName: 'David' }, '+1', { direction: 'outbound' });
      expect(inbound).toContain('Greet them');
      expect(outbound).toContain('Address them');
    });

    it('does not include OUTBOUND framing by default (inbound)', () => {
      const p = buildSystemPrompt(undefined, '+1');
      expect(p).not.toContain('OUTBOUND');
    });
  });
});
