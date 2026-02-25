import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import { ok, created, noContent, badRequest, forbidden, notFound, serverError } from '../response';
import { assertOwnership, parseBody } from '../auth';

const TABLE = process.env['ASSISTANTS_TABLE'] ?? '';

interface IAssistant {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  status: string;
  modelConfig: Record<string, unknown>;
  widgetConfig: Record<string, unknown>;
  apiKey: string;
  allowedDomains: string[];
  createdAt: string;
  updatedAt: string;
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
  bedrockKnowledgeBaseId?: string;
  bedrockGuardrailId?: string;
  bedrockGuardrailVersion?: string;
}

export async function handleAssistants(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  _query: Record<string, string>,
  tenantId: string
): Promise<APIGatewayProxyResultV2> {
  try {
    const id = params['id'];

    // LIST  GET /assistants
    if (method === 'GET' && !id) {
      const items = await ddb.queryItems<IAssistant>(
        TABLE,
        '#t = :t',
        { ':t': tenantId },
        { '#t': 'tenantId' },
        'tenantId-index'
      );
      return ok(items);
    }

    // GET /assistants/:id
    if (method === 'GET' && id) {
      const item = await ddb.getItem<IAssistant>(TABLE, { id });
      if (!item) return notFound('Assistant not found');
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();
      return ok(item);
    }

    // POST /assistants
    if (method === 'POST' && !id) {
      const b = parseBody<{ name: string; description?: string }>(JSON.stringify(body));
      if (!b?.name) return badRequest('name is required');
      const now = new Date().toISOString();
      const assistant: IAssistant = {
        id: uuidv4(),
        tenantId,
        name: b.name,
        description: b.description,
        status: 'draft',
        modelConfig: {
          provider: 'bedrock',
          modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
          modelName: 'Claude 3 Haiku',
          systemPrompt: `You are a helpful AI assistant for ${b.name}.`,
          temperature: 0.7, topP: 0.9, topK: 250, maxTokens: 2048, stopSequences: [],
        },
        widgetConfig: {
          position: 'bottom-right',
          primaryColor: '#006FB4',
          secondaryColor: '#004F82',
          title: b.name,
          welcomeMessage: 'Hello! How can I help you today?',
          placeholder: 'Ask a question...',
          launcherIcon: 'chat',
          showTimestamp: false,
          persistSession: true,
          enableStreaming: true,
          zIndex: 999999,
          trendingQuestions: [],
          contextConfig: { passCurrentUrl: true, passUserId: false, userIdExpression: '', customFields: [] },
        },
        apiKey: `bca_${uuidv4().replace(/-/g, '')}`,
        allowedDomains: [],
        createdAt: now,
        updatedAt: now,
      };
      await ddb.putItem(TABLE, assistant as unknown as Record<string, unknown>);
      return created(assistant);
    }

    // PUT /assistants/:id
    if (method === 'PUT' && id) {
      const item = await ddb.getItem<IAssistant>(TABLE, { id });
      if (!item) return notFound('Assistant not found');
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();
      const updates: Record<string, unknown> = { ...body, updatedAt: new Date().toISOString() };
      delete updates['id'];
      delete updates['tenantId'];
      await ddb.updateItem(TABLE, { id }, updates);
      return ok({ ...item, ...updates });
    }

    // DELETE /assistants/:id
    if (method === 'DELETE' && id) {
      const item = await ddb.getItem<IAssistant>(TABLE, { id });
      if (!item) return notFound('Assistant not found');
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();
      await ddb.deleteItem(TABLE, { id });
      return noContent();
    }

    // POST /assistants/:id/regenerate-key
    if (method === 'POST' && path.endsWith('/regenerate-key')) {
      const item = await ddb.getItem<IAssistant>(TABLE, { id: id! });
      if (!item) return notFound();
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();
      const newKey = `bca_${uuidv4().replace(/-/g, '')}`;
      await ddb.updateItem(TABLE, { id: id! }, { apiKey: newKey, updatedAt: new Date().toISOString() });
      return ok({ apiKey: newKey });
    }

    return notFound();
  } catch (e) {
    console.error('assistants handler error', e);
    return serverError(String(e));
  }
}
