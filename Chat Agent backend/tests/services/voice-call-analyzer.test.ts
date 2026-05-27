import { eventsToTranscript } from '../../src/services/voice-call-analyzer';
import type { ICallEvent } from '../../src/services/voice-call-log';

describe('voice-call-analyzer / eventsToTranscript', () => {
  it('renders tool_use events with the tool name', () => {
    const events: ICallEvent[] = [
      { type: 'tool_use', at: '2026-05-26T10:00:00Z', data: { name: 'searchPatients', input: { phone: '+15551234567' } } },
      { type: 'tool_use', at: '2026-05-26T10:00:05Z', data: { name: 'getAvailableSlots' } },
    ];
    const t = eventsToTranscript(events);
    expect(t).toContain('tool_use: searchPatients');
    expect(t).toContain('tool_use: getAvailableSlots');
    expect(t).toMatch(/\[10:00:00\]/);
    expect(t).toMatch(/\[10:00:05\]/);
  });

  it('renders patient_resolved with patientId', () => {
    const events: ICallEvent[] = [
      { type: 'patient_resolved', at: '2026-05-26T10:00:00Z', data: { patientId: '1167233' } },
    ];
    expect(eventsToTranscript(events)).toContain('patient_resolved: 1167233');
  });

  it('drops noisy recording lifecycle events', () => {
    const events: ICallEvent[] = [
      { type: 'recording_started', at: '2026-05-26T10:00:00Z', data: { recordingSid: 'RE1' } },
      { type: 'recording_complete', at: '2026-05-26T10:05:00Z', data: { url: 'x' } },
    ];
    expect(eventsToTranscript(events).trim()).toBe('');
  });

  it('renders unknown event types with their raw data', () => {
    const events: ICallEvent[] = [
      { type: 'custom_thing', at: '2026-05-26T10:00:00Z', data: { foo: 'bar' } },
    ];
    expect(eventsToTranscript(events)).toContain('custom_thing');
    expect(eventsToTranscript(events)).toContain('"foo":"bar"');
  });

  it('handles empty events array', () => {
    expect(eventsToTranscript([])).toBe('');
  });

  it('handles malformed timestamp gracefully', () => {
    const events: ICallEvent[] = [
      { type: 'foo', at: 'not-a-timestamp' },
    ];
    expect(() => eventsToTranscript(events)).not.toThrow();
  });
});
