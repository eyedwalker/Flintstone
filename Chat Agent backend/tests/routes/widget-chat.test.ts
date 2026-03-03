import { mockDynamoDB, QueryCommand, ScanCommand, GetCommand } from '../helpers/mock-aws';
import { asResult } from '../helpers/test-utils';

// Mock bedrock-chat so we never call real AWS services
jest.mock('../../src/services/bedrock-chat', () => ({
  invokeAgent: jest.fn().mockResolvedValue('Hello from the agent!'),
  describeImage: jest.fn().mockResolvedValue('An image of a cat'),
}));

import { handleWidgetChat } from '../../src/routes/widget-chat';

const ddbMock = mockDynamoDB();

beforeEach(() => {
  ddbMock.reset();
  // Default: no items found for any query/scan/get
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(ScanCommand).resolves({ Items: [] });
  ddbMock.on(GetCommand).resolves({ Item: undefined });
});

describe('handleWidgetChat', () => {
  const makeHeaders = (apiKey?: string): Record<string, string | undefined> => ({
    'x-api-key': apiKey,
    'content-type': 'application/json',
  });

  const mockAssistant = {
    id: 'ast-1',
    tenantId: 'org-1',
    apiKey: 'valid-key-123',
    status: 'ready',
    bedrockAgentId: 'agent-abc',
    bedrockAgentAliasId: 'alias-xyz',
    bedrockKnowledgeBaseId: 'kb-001',
  };

  // -----------------------------------------------------------------------
  // Auth checks
  // -----------------------------------------------------------------------
  it('returns 401 when API key is missing', async () => {
    const r = asResult(await handleWidgetChat(
      { message: 'hello' },
      {},
    ));
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body as string)).toEqual({ error: 'Missing API key' });
  });

  it('returns 401 when API key header is empty string', async () => {
    const r = asResult(await handleWidgetChat(
      { message: 'hello' },
      makeHeaders(''),
    ));
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body as string)).toEqual({ error: 'Missing API key' });
  });

  it('returns 401 when API key is invalid (not found)', async () => {
    // queryItems returns empty (GSI miss), and scanItems also returns empty (fallback miss)
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    const r = asResult(await handleWidgetChat(
      { message: 'hello' },
      makeHeaders('bad-key'),
    ));
    expect(r.statusCode).toBe(401);
    expect(JSON.parse(r.body as string)).toEqual({ error: 'Invalid API key' });
  });

  // -----------------------------------------------------------------------
  // Assistant state checks
  // -----------------------------------------------------------------------
  it('returns 400 when assistant is not ready', async () => {
    const notReadyAssistant = { ...mockAssistant, status: 'provisioning' };
    ddbMock.on(QueryCommand).resolves({ Items: [notReadyAssistant] });

    const r = asResult(await handleWidgetChat(
      { message: 'hello' },
      makeHeaders('valid-key-123'),
    ));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body as string)).toEqual({ error: 'Assistant is not ready' });
  });

  it('returns 400 when assistant has no Bedrock agent', async () => {
    const noAgent = { ...mockAssistant, bedrockAgentId: undefined, bedrockAgentAliasId: undefined };
    ddbMock.on(QueryCommand).resolves({ Items: [noAgent] });

    const r = asResult(await handleWidgetChat(
      { message: 'hello' },
      makeHeaders('valid-key-123'),
    ));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body as string)).toEqual({ error: 'Assistant has no Bedrock agent' });
  });

  // -----------------------------------------------------------------------
  // Message validation
  // -----------------------------------------------------------------------
  it('returns 400 when message is empty', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [mockAssistant] });

    const r = asResult(await handleWidgetChat(
      { message: '' },
      makeHeaders('valid-key-123'),
    ));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body as string)).toEqual({ error: 'message or image is required' });
  });

  it('returns 400 when message is whitespace only', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [mockAssistant] });

    const r = asResult(await handleWidgetChat(
      { message: '   ' },
      makeHeaders('valid-key-123'),
    ));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body as string)).toEqual({ error: 'message or image is required' });
  });

  it('returns 400 when body has no message and no image', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [mockAssistant] });

    const r = asResult(await handleWidgetChat(
      {},
      makeHeaders('valid-key-123'),
    ));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body as string)).toEqual({ error: 'message or image is required' });
  });

  // -----------------------------------------------------------------------
  // Successful invocation
  // -----------------------------------------------------------------------
  it('returns 200 with reply and sessionId on success', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [mockAssistant] });

    const r = asResult(await handleWidgetChat(
      { message: 'What is covered?' },
      makeHeaders('valid-key-123'),
    ));
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body as string);
    expect(body.success).toBe(true);
    expect(body.data.reply).toBe('Hello from the agent!');
    expect(body.data.sessionId).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // GSI fallback
  // -----------------------------------------------------------------------
  it('falls back to scan when GSI query throws', async () => {
    // First QueryCommand call throws (GSI not deployed), ScanCommand succeeds.
    // Subsequent QueryCommand calls (for KB links) should succeed with empty results.
    let queryCallCount = 0;
    ddbMock.on(QueryCommand).callsFake(() => {
      queryCallCount++;
      if (queryCallCount === 1) throw new Error('GSI not found');
      return { Items: [] };
    });
    ddbMock.on(ScanCommand).resolves({ Items: [mockAssistant] });

    const r = asResult(await handleWidgetChat(
      { message: 'hello' },
      makeHeaders('valid-key-123'),
    ));
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body as string);
    expect(body.success).toBe(true);
  });
});
