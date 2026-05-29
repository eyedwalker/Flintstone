// B2 fix: handleVoiceRespond must not crash when CallSid is missing.
// Used to throw DDB ValidationException; should now return a clean hangup TwiML.

jest.mock('../../src/services/conversation-engine', () => ({
  processMessage: jest.fn(),
  loadSession: jest.fn(),
  createSession: jest.fn(),
  saveSession: jest.fn(),
}));

import { handleVoiceRespond } from '../../src/routes/voice';
import * as conversationEngine from '../../src/services/conversation-engine';

const engineMock = conversationEngine as jest.Mocked<typeof conversationEngine>;

describe('handleVoiceRespond — missing CallSid', () => {
  beforeEach(() => engineMock.processMessage.mockReset());

  it('returns 200 with hangup TwiML when CallSid is empty', async () => {
    const r = await handleVoiceRespond({}, 'https://example.com') as { statusCode: number; body: string };
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<Response>');
    expect(r.body).toContain('<Hangup/>');
    expect(r.body).toMatch(/something went wrong/i);
  });

  it('does NOT call conversationEngine when CallSid is empty', async () => {
    await handleVoiceRespond({ SpeechResult: 'hello' }, 'https://example.com');
    expect(engineMock.processMessage).not.toHaveBeenCalled();
  });
});
