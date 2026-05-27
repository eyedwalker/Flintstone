import { mockDynamoDB, PutCommand, UpdateCommand } from '../helpers/mock-aws';

const ddbMock = mockDynamoDB();

jest.mock('../../src/services/sms-intent', () => ({
  classify: jest.fn(),
  isObviousEmergency: jest.fn(),
}));
jest.mock('../../src/services/sms-emergency', () => ({
  escalate: jest.fn().mockResolvedValue({ patientNotified: true, staffNotified: true, errors: [] }),
}));
jest.mock('../../src/services/sms-opt-out', () => ({
  classifyKeyword: jest.fn().mockReturnValue(null),
  setOptOut: jest.fn(),
  clearOptOut: jest.fn(),
  STOP_REPLY: 'unsub',
  START_REPLY: 'resub',
  HELP_REPLY: 'help',
}));
jest.mock('../../src/services/conversation-engine', () => ({
  processMessage: jest.fn().mockResolvedValue({
    response: 'Sure, I can help with that.',
    shouldTransfer: false,
    shouldEndCall: false,
    toolsUsed: [],
    sentiment: { overallScore: 3, emotion: 'neutral', frustrationSignals: 0, escalationNeeded: false },
  }),
}));

import { handleSmsInbound } from '../../src/routes/voice';
import * as smsIntentMod from '../../src/services/sms-intent';
import * as smsEmergencyMod from '../../src/services/sms-emergency';
import * as conversationEngineMod from '../../src/services/conversation-engine';

const intentMock = smsIntentMod as jest.Mocked<typeof smsIntentMod>;
const emergencyMock = smsEmergencyMod as jest.Mocked<typeof smsEmergencyMod>;
const engineMock = conversationEngineMod as jest.Mocked<typeof conversationEngineMod>;

function makeIntent(overrides: Partial<smsIntentMod.ISmsIntentResult> = {}): smsIntentMod.ISmsIntentResult {
  return {
    intent: 'general-question',
    confidence: 0.9,
    urgency: 'low',
    classifiedAt: '2026-05-27T10:00:00Z',
    modelId: 'mock',
    isEmergency: false,
    ...overrides,
  };
}

describe('handleSmsInbound — intent classification + emergency routing', () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
    intentMock.classify.mockReset();
    emergencyMock.escalate.mockClear();
    engineMock.processMessage.mockClear();
  });

  it('routes a routine booking through the conversation engine', async () => {
    intentMock.classify.mockResolvedValueOnce(makeIntent({ intent: 'appointment-booking' }));

    const r = await handleSmsInbound({
      From: '+15551234567', To: '+15806336937', Body: 'Can I book Tuesday at 2?',
      MessageSid: 'SM_test1',
    }) as { statusCode: number; body: string };

    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('Sure, I can help');
    expect(engineMock.processMessage).toHaveBeenCalledTimes(1);
    expect(emergencyMock.escalate).not.toHaveBeenCalled();
  });

  it('short-circuits an emergency: NOT through the conversation engine', async () => {
    intentMock.classify.mockResolvedValueOnce(makeIntent({
      intent: 'emergency',
      urgency: 'high',
      isEmergency: true,
      reasoning: 'chest pain reported',
    }));

    const r = await handleSmsInbound({
      From: '+15551234567', To: '+15806336937', Body: 'I am having chest pain',
      MessageSid: 'SM_test2',
    }) as { statusCode: number; body: string };

    expect(r.statusCode).toBe(200);
    // Empty TwiML response — escalate() sent its own SMS reply via sendSms
    expect(r.body).not.toContain('<Message>');
    expect(emergencyMock.escalate).toHaveBeenCalledTimes(1);
    expect(engineMock.processMessage).not.toHaveBeenCalled();

    const escalateArg = emergencyMock.escalate.mock.calls[0]![0];
    expect(escalateArg.patientPhone).toBe('+15551234567');
    expect(escalateArg.messageBody).toBe('I am having chest pain');
    expect(escalateArg.intent.intent).toBe('emergency');
  });

  it('still classifies + logs even when conversation engine handles the reply', async () => {
    intentMock.classify.mockResolvedValueOnce(makeIntent({ intent: 'billing-question' }));

    await handleSmsInbound({
      From: '+15551234567', To: '+15806336937', Body: 'Why did I get charged twice?',
      MessageSid: 'SM_test3',
    });

    expect(intentMock.classify).toHaveBeenCalledWith('Why did I get charged twice?');
    // PutCommand for startCall, UpdateCommand for appendEvent sms_received +
    // appendEvent sms_replied + endCall. We just verify both fired.
    expect(ddbMock.commandCalls(PutCommand).length).toBeGreaterThanOrEqual(1);
    expect(ddbMock.commandCalls(UpdateCommand).length).toBeGreaterThanOrEqual(2);
  });

  it('STOP still bypasses intent classification entirely', async () => {
    const optOutMod = await import('../../src/services/sms-opt-out');
    (optOutMod.classifyKeyword as jest.Mock).mockReturnValueOnce('STOP');

    const r = await handleSmsInbound({
      From: '+15551234567', To: '+15806336937', Body: 'STOP',
      MessageSid: 'SM_stop',
    }) as { statusCode: number; body: string };

    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('unsub');
    expect(intentMock.classify).not.toHaveBeenCalled();
    expect(engineMock.processMessage).not.toHaveBeenCalled();
  });

  it('handles empty body gracefully without classifying', async () => {
    const r = await handleSmsInbound({
      From: '+15551234567', To: '+15806336937', Body: '',
      MessageSid: 'SM_empty',
    }) as { statusCode: number };

    expect(r.statusCode).toBe(200);
    expect(intentMock.classify).not.toHaveBeenCalled();
  });
});
