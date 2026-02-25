import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getTenantId, parseBody } from './auth';
import { notFound, serverError, forbidden, cors } from './response';
import { handleAssistants } from './routes/assistants';
import { handleHierarchy } from './routes/hierarchy';
import { handleKnowledgeBase } from './routes/knowledge-base';
import { handleGuardrails } from './routes/guardrails';
import { handleTenants } from './routes/tenants';
import { handleMetrics } from './routes/metrics';
import { handleBilling } from './routes/billing';

// Bedrock services (only imported in provision handler, kept separate for cold-start)
import * as bedrockAgent from './services/bedrock-agent';
import * as bedrockKb from './services/bedrock-kb';
import * as s3vectors from './services/s3-vectors';
import * as ddb from './services/dynamo';

const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';
const KB_ROLE = process.env['BEDROCK_KB_ROLE_ARN'] ?? '';
const AGENT_ROLE = process.env['BEDROCK_AGENT_ROLE_ARN'] ?? '';

/**
 * Main API Lambda — handles all routes except /assistants/:id/provision
 * which is handled by provisionHandler (longer timeout).
 */
export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method.toUpperCase();

  // Handle CORS preflight before auth check — no JWT required for OPTIONS
  if (method === 'OPTIONS') return cors();

  const tenantId = getTenantId(event);
  if (!tenantId) return forbidden('Missing tenant identity');

  const rawPath = event.rawPath.replace(/^\/dev|^\/prod/, ''); // strip stage prefix
  const body = parseBody<Record<string, unknown>>(event.body ?? '') ?? {};
  const params = (event.pathParameters ?? {}) as Record<string, string>;
  const query = (event.queryStringParameters ?? {}) as Record<string, string>;

  // With /{proxy+}, pathParameters is {proxy:"resource/UUID/..."} — not {id:"UUID"}.
  // Find the first UUID segment in the path and expose it as params['id'].
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const pathId = rawPath.split('/').find(s => UUID_RE.test(s));
  if (pathId) params['id'] = pathId;

  // Provision is handled by its own Lambda (separate file, longer timeout)
  if (rawPath.match(/^\/assistants\/[^/]+\/provision$/) && method === 'POST') {
    return notFound('Use the provision endpoint');
  }

  try {
    if (rawPath.startsWith('/assistants')) {
      return handleAssistants(method, rawPath, body, params, query, tenantId);
    }
    if (rawPath.startsWith('/hierarchy')) {
      return handleHierarchy(method, rawPath, body, params, query, tenantId);
    }
    if (rawPath.startsWith('/knowledge-base')) {
      return handleKnowledgeBase(method, rawPath, body, params, query, tenantId);
    }
    if (rawPath.startsWith('/guardrails')) {
      return handleGuardrails(method, rawPath, body, params, query, tenantId);
    }
    if (rawPath.startsWith('/tenants')) {
      return handleTenants(method, rawPath, body, params, query, tenantId);
    }
    if (rawPath.startsWith('/metrics')) {
      return handleMetrics(method, rawPath, body, params, query, tenantId);
    }
    if (rawPath.startsWith('/billing')) {
      return handleBilling(method, rawPath, body, params, query, tenantId);
    }
    return notFound('Route not found');
  } catch (e) {
    console.error('Unhandled error', e);
    return serverError();
  }
};

/**
 * Provision Lambda — 5-minute timeout for creating Bedrock Agent + Knowledge Base.
 * Called by POST /assistants/:id/provision
 */
export const provisionHandler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method.toUpperCase();
  if (method === 'OPTIONS') return cors();

  const tenantId = getTenantId(event);
  if (!tenantId) return forbidden('Missing tenant identity');

  const provRawPath = event.rawPath.replace(/^\/dev|^\/prod/, '');
  const PUUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const assistantId = event.pathParameters?.['id'] ?? provRawPath.split('/').find(s => PUUID_RE.test(s));
  if (!assistantId) return serverError('Missing assistant id');

  try {
    const assistant = await ddb.getItem<{
      id: string; tenantId: string; name: string;
      modelConfig: { modelId: string; systemPrompt?: string; temperature?: number; topP?: number; topK?: number; maxTokens?: number; stopSequences?: string[] };
      bedrockAgentId?: string;
    }>(ASSISTANTS_TABLE, { id: assistantId });

    if (!assistant) return notFound('Assistant not found');
    if (assistant.tenantId !== tenantId) return forbidden();

    // Mark as provisioning
    await ddb.updateItem(ASSISTANTS_TABLE, { id: assistantId }, {
      status: 'provisioning',
      updatedAt: new Date().toISOString(),
    });

    // 1. Create S3 Vectors bucket + index (vector store for Bedrock KB)
    // Bucket name: "v" + UUID without hyphens (33 chars, globally unique, valid S3 Vectors name)
    const vectorBucketName = `v${assistantId.replace(/-/g, '')}`;
    const vectorIndexName = 'kb-index';
    const vectorStore = await s3vectors.createVectorStore(vectorBucketName, vectorIndexName);

    // 2. Create Knowledge Base backed by S3 Vectors
    const kbName = `${assistantId}-kb`;
    const kbResult = await bedrockKb.createKnowledgeBase(
      kbName, KB_ROLE,
      vectorStore.vectorBucketArn, vectorStore.indexArn, vectorIndexName
    );

    // 2. Create Bedrock Agent
    const agentResult = await bedrockAgent.createAgent(
      assistant.name,
      assistant.modelConfig,
      AGENT_ROLE
    );

    // 3. Associate KB with Agent
    await bedrockAgent.associateKnowledgeBase(
      agentResult.agentId, 'DRAFT', kbResult.knowledgeBaseId,
      `Knowledge base for ${assistant.name}`
    );

    // 4. Prepare agent and create production alias
    await bedrockAgent.prepareAgent(agentResult.agentId);
    const aliasResult = await bedrockAgent.createAlias(agentResult.agentId, 'production', '1');

    // 5. Persist IDs
    await ddb.updateItem(ASSISTANTS_TABLE, { id: assistantId }, {
      bedrockKnowledgeBaseId: kbResult.knowledgeBaseId,
      bedrockAgentId: agentResult.agentId,
      bedrockAgentAliasId: aliasResult.agentAliasId,
      vectorBucketName,
      vectorIndexName,
      status: 'ready',
      updatedAt: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        bedrockKnowledgeBaseId: kbResult.knowledgeBaseId,
        bedrockAgentId: agentResult.agentId,
        bedrockAgentAliasId: aliasResult.agentAliasId,
      }),
    };
  } catch (e) {
    console.error('Provision error', e);
    await ddb.updateItem(ASSISTANTS_TABLE, { id: assistantId! }, {
      status: 'error',
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return serverError(`Provision failed: ${String(e)}`);
  }
};
