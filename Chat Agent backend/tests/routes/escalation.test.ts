import { mockDynamoDB, GetCommand, ScanCommand } from '../helpers/mock-aws';
import { asResult } from '../helpers/test-utils';
import { handleWidgetCheckEscalation } from '../../src/routes/escalation';

const ddbMock = mockDynamoDB();

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: undefined });
  ddbMock.on(ScanCommand).resolves({ Items: [] });
});

describe('handleWidgetCheckEscalation', () => {
  const makeHeaders = (apiKey: string) => ({
    'x-api-key': apiKey,
    'content-type': 'application/json',
  });

  const mockAssistant = {
    id: 'ast-1',
    tenantId: 'org-1',
    apiKey: 'test-key-123',
    status: 'ready',
  };

  it('rejects missing API key', async () => {
    const r = asResult(await handleWidgetCheckEscalation(
      { messages: [{ role: 'user', content: 'hello' }] }, {},
    ));
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body as string)).toEqual({ error: 'Missing API key' });
  });

  it('rejects invalid API key', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    const r = asResult(await handleWidgetCheckEscalation(
      { messages: [{ role: 'user', content: 'hello' }] }, makeHeaders('bad-key'),
    ));
    expect(r.statusCode).toBe(401);
  });

  it('returns shouldEscalate false when escalation is disabled', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [mockAssistant] });
    ddbMock.on(GetCommand).resolves({ Item: { enabled: false } });

    const r = asResult(await handleWidgetCheckEscalation(
      { messages: [{ role: 'user', content: 'help me' }] }, makeHeaders('test-key-123'),
    ));
    expect(JSON.parse(r.body as string).shouldEscalate).toBe(false);
  });

  it('returns shouldEscalate false when trigger mode is manual', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [mockAssistant] });
    ddbMock.on(GetCommand).resolves({
      Item: { enabled: true, triggerMode: 'manual', autoTriggers: { keywords: ['frustrated'] } },
    });

    const r = asResult(await handleWidgetCheckEscalation(
      { messages: [{ role: 'user', content: 'I am frustrated' }] }, makeHeaders('test-key-123'),
    ));
    expect(JSON.parse(r.body as string).shouldEscalate).toBe(false);
  });

  it('detects keyword trigger', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [mockAssistant] });
    ddbMock.on(GetCommand).resolves({
      Item: { enabled: true, triggerMode: 'auto', autoTriggers: { keywords: ['speak to human', 'frustrated'] } },
    });

    const r = asResult(await handleWidgetCheckEscalation(
      { messages: [{ role: 'user', content: 'I am frustrated with this' }] }, makeHeaders('test-key-123'),
    ));
    const body = JSON.parse(r.body as string);
    expect(body.shouldEscalate).toBe(true);
    expect(body.reason).toContain('frustrated');
  });

  it('detects max turns exceeded', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [mockAssistant] });
    ddbMock.on(GetCommand).resolves({
      Item: { enabled: true, triggerMode: 'both', autoTriggers: { keywords: [], maxTurns: 5 } },
    });

    const r = asResult(await handleWidgetCheckEscalation(
      { messages: Array(6).fill({ role: 'user', content: 'q' }), turnCount: 6 }, makeHeaders('test-key-123'),
    ));
    const body = JSON.parse(r.body as string);
    expect(body.shouldEscalate).toBe(true);
    expect(body.reason).toContain('Max turns');
  });

  it('does not trigger when under max turns', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [mockAssistant] });
    ddbMock.on(GetCommand).resolves({
      Item: { enabled: true, triggerMode: 'auto', autoTriggers: { keywords: [], maxTurns: 10 } },
    });

    const r = asResult(await handleWidgetCheckEscalation(
      { messages: [{ role: 'user', content: 'q' }], turnCount: 3 }, makeHeaders('test-key-123'),
    ));
    expect(JSON.parse(r.body as string).shouldEscalate).toBe(false);
  });
});
