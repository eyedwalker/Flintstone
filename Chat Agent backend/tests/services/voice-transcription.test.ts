import { extractTranscriptText } from '../../src/services/voice-transcription';

describe('voice-transcription / extractTranscriptText', () => {
  it('returns the unified transcript when no channel labels exist', () => {
    const json = JSON.stringify({
      results: { transcripts: [{ transcript: 'hello there how can I help' }] },
    });
    expect(extractTranscriptText(json)).toBe('hello there how can I help');
  });

  it('renders channel-labeled output with caller/assistant labels', () => {
    const json = JSON.stringify({
      results: {
        channel_labels: {
          channels: [
            {
              channel_label: 'ch_0',
              items: [
                { alternatives: [{ content: 'Hi' }] },
                { alternatives: [{ content: 'this' }] },
                { alternatives: [{ content: 'is' }] },
                { alternatives: [{ content: 'Emily' }] },
              ],
            },
            {
              channel_label: 'ch_1',
              items: [
                { alternatives: [{ content: 'I' }] },
                { alternatives: [{ content: 'need' }] },
                { alternatives: [{ content: 'an' }] },
                { alternatives: [{ content: 'appointment' }] },
              ],
            },
          ],
        },
        transcripts: [{ transcript: 'Hi this is Emily I need an appointment' }],
      },
    });
    const out = extractTranscriptText(json);
    expect(out).toContain('assistant: Hi this is Emily');
    expect(out).toContain('caller: I need an appointment');
  });

  it('falls back to unified transcript when channel_labels is empty', () => {
    const json = JSON.stringify({
      results: {
        channel_labels: { channels: [] },
        transcripts: [{ transcript: 'fallback text' }],
      },
    });
    expect(extractTranscriptText(json)).toBe('fallback text');
  });

  it('returns "" for malformed JSON without throwing', () => {
    expect(extractTranscriptText('not-json')).toBe('');
  });

  it('returns "" when results.transcripts is missing', () => {
    expect(extractTranscriptText('{}')).toBe('');
    expect(extractTranscriptText(JSON.stringify({ results: {} }))).toBe('');
  });

  it('skips channels with no items but still produces output for populated ones', () => {
    const json = JSON.stringify({
      results: {
        channel_labels: {
          channels: [
            { channel_label: 'ch_0', items: [] },
            { channel_label: 'ch_1', items: [{ alternatives: [{ content: 'hello' }] }] },
          ],
        },
      },
    });
    const out = extractTranscriptText(json);
    expect(out).toBe('caller: hello');
    expect(out).not.toContain('assistant:');
  });

  it('preserves word order from items array', () => {
    const json = JSON.stringify({
      results: {
        channel_labels: {
          channels: [
            {
              channel_label: 'ch_0',
              items: [
                { alternatives: [{ content: 'one' }] },
                { alternatives: [{ content: 'two' }] },
                { alternatives: [{ content: 'three' }] },
              ],
            },
          ],
        },
      },
    });
    expect(extractTranscriptText(json)).toBe('assistant: one two three');
  });
});
