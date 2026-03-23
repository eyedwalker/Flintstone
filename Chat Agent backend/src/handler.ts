import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import * as fs from 'fs';
import * as path from 'path';
import { resolveRequestContext, requireRole, parseBody } from './auth';
import { ok, notFound, serverError, forbidden, badRequest, cors, corsHeaders } from './response';
import { handleAssistants } from './routes/assistants';
import { handleChat } from './routes/chat';
import { handleWidgetChat, handleWidgetChatPoll, handleWidgetDownload, processChatJob } from './routes/widget-chat';
import { handleHierarchy } from './routes/hierarchy';
import { handleKnowledgeBase } from './routes/knowledge-base';
import { handleGuardrails } from './routes/guardrails';
import { handleTenants } from './routes/tenants';
import { handleMetrics, handleWidgetFeedback } from './routes/metrics';
import { handleBilling } from './routes/billing';
import { handleTeam } from './routes/team';
import { handleKnowledgeBaseDefinitions } from './routes/knowledge-base-definitions';
import { handleEscalation, handleWidgetEscalation, handleWidgetCheckEscalation, handleWidgetCaseComment, handleWidgetCaseStatus } from './routes/escalation';
import { handleAttachments, handleWidgetAttachmentUrl, handleWidgetAttachmentConfirm } from './routes/attachments';
import { handleWidgetPresets } from './routes/widget-presets';
import { handleScreenMappings, handleWidgetScreenContext } from './routes/screen-mappings';
import { handleTestSuites, handleTestRuns } from './routes/test-suites';
import { handleExternalBot } from './routes/external-bot';
import { handleReportSchedules } from './routes/report-schedules';
import { handleAgentConfig } from './routes/agent-config';

// Bedrock services (only imported in provision handler, kept separate for cold-start)
import * as bedrockAgent from './services/bedrock-agent';
import * as bedrockKb from './services/bedrock-kb';
import * as s3vectors from './services/s3-vectors';
import * as ddb from './services/dynamo';

const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';
const KB_ROLE = process.env['BEDROCK_KB_ROLE_ARN'] ?? '';
const AGENT_ROLE = process.env['BEDROCK_AGENT_ROLE_ARN'] ?? '';
const ASSISTANT_KB_TABLE = process.env['ASSISTANT_KB_TABLE'] ?? '';
const KB_DEFS_TABLE = process.env['KNOWLEDGE_BASES_TABLE'] ?? '';

interface IAssistantKbLink {
  assistantId: string;
  knowledgeBaseId: string;
  tenantId: string;
  linkedAt: string;
}

interface IKbDef {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  bedrockKnowledgeBaseId?: string;
  status: string;
}

/**
 * Main API Lambda — handles all routes except /assistants/:id/provision
 * which is handled by provisionHandler (longer timeout).
 *
 * Also handles Bedrock Agent action group invocations (different event shape).
 */
export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer & Record<string, unknown>
): Promise<APIGatewayProxyResultV2 | Record<string, unknown>> => {
  // ── Bedrock Action Group invocation ─────────────────────────────────────
  // When Bedrock invokes this Lambda for a tool call, the event shape is:
  //   OpenAPI-based: { actionGroup, apiPath, httpMethod, parameters, sessionAttributes, ... }
  //   Function-based: { actionGroup, function, parameters, sessionAttributes, ... }
  if ((event as any).actionGroup && ((event as any).apiPath || (event as any).function)) {
    const actionGroupName = (event as any).actionGroup ?? '';

    // Route to the correct action group handler
    if (actionGroupName.includes('escalation') || actionGroupName.includes('support')) {
      const { handleEscalationAction } = await import('./services/escalation-agent');
      return handleEscalationAction(event as any) as any;
    }

    const { handleActionGroup } = await import('./services/front-office-actions');
    return handleActionGroup(event as any) as any;
  }

  const method = event.requestContext.http.method.toUpperCase();

  // Handle CORS preflight before auth check — no JWT required for OPTIONS
  if (method === 'OPTIONS') return cors();

  const rawPath = event.rawPath.replace(/^\/dev|^\/prod/, ''); // strip stage prefix
  const body = parseBody<Record<string, unknown>>(event.body ?? '') ?? {};

  // OpenAPI spec — public, no auth required
  if (rawPath === '/docs/openapi.yaml' && method === 'GET') {
    try {
      const spec = fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf-8');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/yaml', ...corsHeaders() },
        body: spec,
      };
    } catch {
      return notFound('OpenAPI spec not found');
    }
  }

  // ── Voice/SMS webhooks — no JWT, Twilio signature auth ──────────────────
  if (rawPath.startsWith('/voice/')) {
    // Parse URL-encoded body from Twilio
    let voiceBody: Record<string, string> = {};
    const ct = event.headers['content-type'] ?? '';
    if (ct.includes('application/x-www-form-urlencoded') && event.body) {
      const params = new URLSearchParams(event.body);
      voiceBody = Object.fromEntries(params.entries());
    } else {
      voiceBody = body as Record<string, string>;
    }

    const host = event.headers['host'] ?? '';
    const stage = event.rawPath.startsWith('/dev') ? '/dev' : event.rawPath.startsWith('/prod') ? '/prod' : '';
    const baseUrl = `https://${host}${stage}`;

    const { handleInboundCall, handleVoiceRespond, handleOutboundTwiml, handleSmsInbound, handleCallStatus } = await import('./routes/voice');

    if (rawPath === '/voice/inbound' && method === 'POST') return handleInboundCall(voiceBody, baseUrl);
    if (rawPath === '/voice/respond' && method === 'POST') return handleVoiceRespond(voiceBody, baseUrl);
    if (rawPath === '/voice/outbound-twiml' && method === 'GET') {
      return handleOutboundTwiml((event.queryStringParameters ?? {}) as Record<string, string>, baseUrl);
    }
    if (rawPath === '/voice/sms-inbound' && method === 'POST') return handleSmsInbound(voiceBody);
    if (rawPath === '/voice/status' && method === 'POST') return handleCallStatus(voiceBody);
  }

  // Public widget endpoints — authenticated via API key, no JWT required
  if (rawPath === '/widget/chat' && method === 'POST') {
    return handleWidgetChat(body, event.headers);
  }
  // Poll for async chat job result: GET /widget/chat/{jobId}
  const chatPollMatch = rawPath.match(/^\/widget\/chat\/([a-f0-9-]+)$/);
  if (chatPollMatch && method === 'GET') {
    return handleWidgetChatPoll(chatPollMatch[1], event.headers);
  }
  // Secure file download: GET /widget/download/{key+}
  const downloadMatch = rawPath.match(/^\/widget\/download\/(.+)$/);
  if (downloadMatch && method === 'GET') {
    return handleWidgetDownload(decodeURIComponent(downloadMatch[1]), event.headers);
  }
  if (rawPath === '/widget/escalate' && method === 'POST') {
    return handleWidgetEscalation(body, event.headers);
  }
  if (rawPath === '/widget/check-escalation' && method === 'POST') {
    return handleWidgetCheckEscalation(body, event.headers);
  }
  if (rawPath === '/widget/case-comment' && method === 'POST') {
    return handleWidgetCaseComment(body, event.headers);
  }
  if (rawPath === '/widget/case-status' && method === 'POST') {
    return handleWidgetCaseStatus(body, event.headers);
  }
  if (rawPath === '/widget/feedback' && method === 'POST') {
    return handleWidgetFeedback(body, event.headers);
  }
  if (rawPath === '/widget/attachment-url' && method === 'POST') {
    return handleWidgetAttachmentUrl(body, event.headers);
  }
  if (rawPath === '/widget/attachment-confirm' && method === 'POST') {
    return handleWidgetAttachmentConfirm(body, event.headers);
  }
  if (rawPath === '/widget/screen-context' && method === 'GET') {
    return handleWidgetScreenContext((event.queryStringParameters ?? {}) as Record<string, string>);
  }

  const ctx = await resolveRequestContext(event);
  if (!ctx) return forbidden('Missing tenant identity');

  const params = (event.pathParameters ?? {}) as Record<string, string>;
  const query = (event.queryStringParameters ?? {}) as Record<string, string>;
  const sourceIp = event.requestContext.http.sourceIp ?? '';

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
    // Chat must be checked before generic /assistants handler
    if (rawPath.match(/^\/assistants\/[^/]+\/chat$/) && method === 'POST') {
      return handleChat(rawPath, body, params, ctx.organizationId);
    }
    if (rawPath.startsWith('/assistants')) {
      return handleAssistants(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/hierarchy')) {
      return handleHierarchy(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/knowledge-bases')) {
      return handleKnowledgeBaseDefinitions(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/knowledge-base')) {
      return handleKnowledgeBase(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/guardrails')) {
      return handleGuardrails(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/tenants')) {
      return handleTenants(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/metrics')) {
      return handleMetrics(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/billing')) {
      return handleBilling(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/team')) {
      return handleTeam(method, rawPath, body, params, query, ctx, sourceIp);
    }
    if (rawPath.startsWith('/escalation')) {
      return handleEscalation(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/attachments')) {
      return handleAttachments(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/widget-presets')) {
      return handleWidgetPresets(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/screen-mappings')) {
      return handleScreenMappings(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/test-suites')) {
      return handleTestSuites(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/test-runs')) {
      return handleTestRuns(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/external-bot')) {
      return handleExternalBot(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/report-schedules')) {
      return handleReportSchedules(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/agent-config')) {
      return handleAgentConfig(method, rawPath, body, params, query, ctx);
    }
    if (rawPath.startsWith('/raft')) {
      const { handleRaft } = await import('./routes/raft');
      return handleRaft(method, rawPath, body, params, query, ctx);
    }
    return notFound('Route not found');
  } catch (e) {
    console.error('Unhandled error', e);
    return serverError();
  }
};

/**
 * Crawl job handler — invoked asynchronously by the API Lambda for URL ingestion.
 * Runs in the provision Lambda which has a 5-minute timeout.
 */
async function handleCrawlJob(job: {
  contentId: string; url: string; tenantId: string; assistantId: string;
  knowledgeBaseId: string; maxDepth: number; maxPages: number;
  scope: string; minRoleLevel: number; useBDA: boolean;
}): Promise<void> {
  const { default: webCrawler } = await import('./services/web-crawler') as any;
  const crawl = (await import('./services/web-crawler')).crawl;
  const composePageDocument = (await import('./services/web-crawler')).composePageDocument;
  const s3 = await import('./services/s3');

  const CONTENT_TABLE = process.env['CONTENT_TABLE'] ?? '';
  const BUCKET = process.env['S3_CONTENT_BUCKET'] ?? '';

  try {
    // Phase 1: Crawl — report progress every 10 pages
    let lastProgressUpdate = 0;
    const pages = await crawl(job.url, {
      maxDepth: job.maxDepth,
      maxPages: job.maxPages,
      onProgress: async (crawled, queued) => {
        if (crawled - lastProgressUpdate >= 10 || crawled === 1) {
          lastProgressUpdate = crawled;
          await ddb.updateItem(CONTENT_TABLE, { id: job.contentId }, {
            crawlProgress: { phase: 'crawling', pagesCrawled: crawled, pagesQueued: queued },
            updatedAt: new Date().toISOString(),
          });
        }
      },
    });
    if (pages.length === 0) {
      await ddb.updateItem(CONTENT_TABLE, { id: job.contentId }, {
        status: 'error',
        errorMessage: 'Could not fetch any content from this URL',
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    // Phase 2: Upload to S3
    const siteTitle = pages[0]?.title || new URL(job.url).hostname;
    const s3Prefix = `${job.tenantId}/${job.assistantId}/${job.contentId}/`;

    await ddb.updateItem(CONTENT_TABLE, { id: job.contentId }, {
      name: siteTitle,
      crawlProgress: { phase: 'uploading', pagesCrawled: pages.length, pagesUploaded: 0 },
      updatedAt: new Date().toISOString(),
    });

    let totalBytes = 0;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageDoc = composePageDocument(page);
      const pageKey = `${s3Prefix}page-${String(i).padStart(4, '0')}.txt`;

      await s3.putObject(pageKey, pageDoc, 'text/plain');
      totalBytes += Buffer.byteLength(pageDoc, 'utf-8');

      await s3.putJsonObject(`${pageKey}.metadata.json`, {
        metadataAttributes: {
          minRoleLevel: job.minRoleLevel,
          scope: job.scope,
          contentId: job.contentId,
          assistantId: job.assistantId,
          sourceUrl: page.url,
          pageTitle: page.title,
        },
      });

      // Update upload progress every 25 pages
      if ((i + 1) % 25 === 0 || i === pages.length - 1) {
        await ddb.updateItem(CONTENT_TABLE, { id: job.contentId }, {
          crawlProgress: { phase: 'uploading', pagesCrawled: pages.length, pagesUploaded: i + 1 },
          updatedAt: new Date().toISOString(),
        });
      }
    }

    // Phase 3: Ingestion
    await ddb.updateItem(CONTENT_TABLE, { id: job.contentId }, {
      crawlProgress: { phase: 'ingesting', pagesCrawled: pages.length, pagesUploaded: pages.length },
      updatedAt: new Date().toISOString(),
    });

    const bucketArn = `arn:aws:s3:::${BUCKET}`;
    const dsRes = await bedrockKb.createS3DataSource(
      job.knowledgeBaseId, `url-${job.contentId}`, bucketArn, s3Prefix, job.useBDA
    );
    const jobRes = await bedrockKb.startIngestionJob(job.knowledgeBaseId, dsRes.dataSourceId);

    await ddb.updateItem(CONTENT_TABLE, { id: job.contentId }, {
      name: siteTitle,
      s3Key: s3Prefix,
      dataSourceId: dsRes.dataSourceId,
      ingestionJobId: jobRes.ingestionJobId,
      fileSize: totalBytes,
      crawlProgress: { phase: 'ingesting', pagesCrawled: pages.length, pagesUploaded: pages.length },
      updatedAt: new Date().toISOString(),
    });

    console.log(`Crawl job done: ${pages.length} pages, contentId=${job.contentId}`);
  } catch (e) {
    console.error('Crawl job error', e);
    await ddb.updateItem(CONTENT_TABLE, { id: job.contentId }, {
      status: 'error',
      errorMessage: `Crawl failed: ${String(e)}`,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Provision Lambda — 5-minute timeout for creating Bedrock Agent + Knowledge Base.
 * Called by POST /assistants/:id/provision
 * Also handles async crawl jobs dispatched from the API Lambda.
 */
export const provisionHandler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  // Handle async jobs (invoked via Lambda.invoke, not API Gateway)
  const anyEvent = event as any;
  if (anyEvent._chatJob) {
    await processChatJob(anyEvent._chatJob);
    return { statusCode: 200, body: 'ok' };
  }
  if (anyEvent._crawlJob) {
    await handleCrawlJob(anyEvent._crawlJob);
    return { statusCode: 200, body: 'ok' };
  }
  if (anyEvent._reportJob) {
    const { executeScheduledReport } = await import('./services/report-scheduler');
    await executeScheduledReport(anyEvent._reportJob);
    return { statusCode: 200, body: 'ok' };
  }

  const method = event.requestContext.http.method.toUpperCase();
  if (method === 'OPTIONS') return cors();

  const ctx = await resolveRequestContext(event);
  if (!ctx) return forbidden('Missing tenant identity');
  if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');

  const provRawPath = event.rawPath.replace(/^\/dev|^\/prod/, '');
  const PUUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const assistantId = event.pathParameters?.['id'] ?? provRawPath.split('/').find(s => PUUID_RE.test(s));
  if (!assistantId) return serverError('Missing assistant id');

  try {
    const assistant = await ddb.getItem<{
      id: string; tenantId: string; name: string;
      modelConfig: { modelId: string; systemPrompt?: string; temperature?: number; topP?: number; topK?: number; maxTokens?: number; stopSequences?: string[] };
      bedrockAgentId?: string;
      bedrockKnowledgeBaseId?: string;
      bedrockAgentAliasId?: string;
      vectorBucketName?: string;
      vectorIndexName?: string;
    }>(ASSISTANTS_TABLE, { id: assistantId });

    if (!assistant) return notFound('Assistant not found');
    if (assistant.tenantId !== ctx.organizationId) return forbidden();

    // Mark as provisioning
    await ddb.updateItem(ASSISTANTS_TABLE, { id: assistantId }, {
      status: 'provisioning',
      updatedAt: new Date().toISOString(),
    });

    // 1. Create Bedrock Agent (skip if already created)
    // Bedrock agent names: 1-100 chars, alphanumeric/underscore/hyphen only, must start with alphanumeric
    const agentName = assistant.name
      .replace(/[^a-zA-Z0-9_-]/g, '-')  // replace invalid chars with hyphen
      .replace(/^[^a-zA-Z0-9]+/, '')     // strip leading non-alphanumeric
      .slice(0, 100) || 'assistant';

    let agentId = assistant.bedrockAgentId ?? '';
    if (!agentId) {
      const agentResult = await bedrockAgent.createAgent(agentName, assistant.modelConfig, AGENT_ROLE);
      agentId = agentResult.agentId;
    }

    // 2. Look up all linked KBs from junction table
    let kbLinks = await ddb.queryItems<IAssistantKbLink>(
      ASSISTANT_KB_TABLE, 'assistantId = :a', { ':a': assistantId }
    );

    // If no KBs linked, auto-link the org default KB (if one exists)
    if (kbLinks.length === 0) {
      const allKbDefs = await ddb.queryItems<IKbDef>(
        KB_DEFS_TABLE, 'tenantId = :t', { ':t': ctx.organizationId },
        undefined, 'tenantId-index'
      );
      const defaultKb = allKbDefs.find(kb => kb.isDefault && kb.bedrockKnowledgeBaseId);
      if (defaultKb) {
        await ddb.putItem(ASSISTANT_KB_TABLE, {
          assistantId,
          knowledgeBaseId: defaultKb.id,
          tenantId: ctx.organizationId,
          linkedAt: new Date().toISOString(),
        });
        kbLinks = [{ assistantId, knowledgeBaseId: defaultKb.id, tenantId: ctx.organizationId, linkedAt: new Date().toISOString() }];
      }
    }

    // 3. Backward compat: if assistant has a legacy bedrockKnowledgeBaseId but no KB defs, keep it
    let legacyKbId = assistant.bedrockKnowledgeBaseId ?? '';

    if (kbLinks.length === 0 && !legacyKbId) {
      // No linked KBs and no legacy KB — create a per-assistant KB (original flow)
      const vectorBucketName = assistant.vectorBucketName ?? `v${assistantId.replace(/-/g, '')}`;
      const vectorIndexName = assistant.vectorIndexName ?? 'kb-index';
      const vectorStore = await s3vectors.createVectorStore(vectorBucketName, vectorIndexName);

      const kbName = `${assistantId}-kb`;
      const kbResult = await bedrockKb.createKnowledgeBase(
        kbName, KB_ROLE,
        vectorStore.vectorBucketArn, vectorStore.indexArn
      );
      legacyKbId = kbResult.knowledgeBaseId;

      await ddb.updateItem(ASSISTANTS_TABLE, { id: assistantId }, {
        vectorBucketName,
        vectorIndexName,
        bedrockKnowledgeBaseId: legacyKbId,
      });
    }

    // 4. Associate all linked KB definitions with the agent
    const associatedKbIds: string[] = [];
    for (const link of kbLinks) {
      const kbDef = await ddb.getItem<IKbDef>(KB_DEFS_TABLE, { id: link.knowledgeBaseId });
      if (kbDef?.bedrockKnowledgeBaseId) {
        await bedrockAgent.associateKnowledgeBase(
          agentId, 'DRAFT', kbDef.bedrockKnowledgeBaseId,
          `Knowledge base: ${kbDef.name}`
        ).catch(() => { /* ignore if already associated */ });
        associatedKbIds.push(kbDef.bedrockKnowledgeBaseId);
      }
    }

    // Also associate the legacy per-assistant KB if present
    if (legacyKbId && !associatedKbIds.includes(legacyKbId)) {
      await bedrockAgent.associateKnowledgeBase(
        agentId, 'DRAFT', legacyKbId,
        `Knowledge base for ${assistant.name}`
      ).catch(() => { /* ignore if already associated */ });
      associatedKbIds.push(legacyKbId);
    }

    // 5. Prepare agent (marks DRAFT as PREPARED)
    await bedrockAgent.prepareAgent(agentId);

    // Use the built-in TSTALIASID alias which always points to the DRAFT version.
    const aliasId = 'TSTALIASID';

    // 6. Persist IDs
    await ddb.updateItem(ASSISTANTS_TABLE, { id: assistantId }, {
      bedrockAgentId: agentId,
      bedrockAgentAliasId: aliasId,
      bedrockKnowledgeBaseId: legacyKbId || associatedKbIds[0] || '',
      status: 'ready',
      updatedAt: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        bedrockAgentId: agentId,
        bedrockAgentAliasId: aliasId,
        associatedKnowledgeBases: associatedKbIds,
      }),
    };
  } catch (e) {
    console.error('Provision error', e);
    await ddb.updateItem(ASSISTANTS_TABLE, { id: assistantId! }, {
      status: 'error',
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
    return serverError(String(e));
  }
};

/**
 * Test Runner Lambda — 15-minute timeout for executing test suites.
 * Called by POST /test-suites/:suiteId/run
 * Also handles continuation invocations for large test suites.
 */
export const testRunnerHandler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyResultV2> => {
  const anyEvent = event as any;

  // Handle async screen mapping generation
  if (anyEvent._screenMappingGeneration) {
    const { assistantId, tenantId } = anyEvent._screenMappingGeneration;
    try {
      console.log(`Starting async screen mapping generation for assistant ${assistantId}`);
      const { generateMappings } = await import('./services/screen-mapping-ai');
      const result = await generateMappings(assistantId, tenantId);
      console.log(`Screen mapping complete: ${result.count} mappings`);
    } catch (e) {
      console.error('Screen mapping generation failed:', e);
    }
    return { statusCode: 200, body: 'ok' };
  }

  // Handle async test case generation (invoked from /generate endpoint)
  if (anyEvent._testGeneration) {
    const { suiteId, assistantId, tenantId, count, categories } = anyEvent._testGeneration;
    const TEST_SUITES_TABLE = process.env['TEST_SUITES_TABLE'] ?? '';
    const TEST_CASES_TABLE = process.env['TEST_CASES_TABLE'] ?? '';
    try {
      console.log(`Starting async test generation for suite ${suiteId}, target ${count} cases`);
      const { generateTestCases } = await import('./services/test-generation');
      const result = await generateTestCases(suiteId, assistantId, tenantId, count, categories);
      console.log(`Generation complete: ${result.count} cases`);

      // Update suite case count
      const cases = await ddb.queryItems<{ id: string }>(
        TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
      );
      await ddb.updateItem(TEST_SUITES_TABLE, { id: suiteId }, {
        testCaseCount: cases.length,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Async test generation failed:', e);
    }
    return { statusCode: 200, body: 'ok' };
  }

  // Handle external bot quick test (async Lambda invoke from /external-bot/test)
  if (anyEvent._externalBotQuickTest) {
    const { jobId, tenantId, questions, config } = anyEvent._externalBotQuickTest;
    const QT_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
    try {
      console.log(`Starting external bot quick test ${jobId}: ${questions.length} questions`);
      const { executeExternalBotQuickTest } = await import('./routes/external-bot');
      await executeExternalBotQuickTest(jobId, tenantId, questions, config);
      console.log(`External bot quick test ${jobId} completed`);
    } catch (e) {
      console.error('External bot quick test failed:', e);
      await ddb.updateItem(QT_RUNS_TABLE, { id: jobId }, {
        status: 'failed',
        quickTestError: String(e).slice(0, 500),
        updatedAt: new Date().toISOString(),
      });
    }
    return { statusCode: 200, body: 'ok' };
  }

  // Handle external bot test run (async Lambda invoke from /external-bot/run/:suiteId)
  if (anyEvent._externalBotRun) {
    const { runId, suiteId, assistantId, tenantId } = anyEvent._externalBotRun;
    const EBR_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
    try {
      console.log(`Starting external bot test run ${runId} for suite ${suiteId}`);
      const { executeExternalBotRun } = await import('./routes/external-bot');
      await executeExternalBotRun(runId, suiteId, assistantId, tenantId);
      console.log(`External bot test run ${runId} completed`);
    } catch (e) {
      console.error('External bot test run failed:', e);
      await ddb.updateItem(EBR_RUNS_TABLE, { id: runId }, {
        status: 'failed',
        updatedAt: new Date().toISOString(),
      });
    }
    return { statusCode: 200, body: 'ok' };
  }

  // Handle continuation invocations (async Lambda self-invoke)
  if (anyEvent._testRunContinuation) {
    const { runId, suiteId, assistantId, tenantId, offset } = anyEvent._testRunContinuation;
    const TEST_SUITES_TABLE = process.env['TEST_SUITES_TABLE'] ?? '';
    const TEST_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
    try {
      const { executeTestRun } = await import('./services/test-runner');
      await executeTestRun(runId, suiteId, assistantId, tenantId, offset);
      // executeTestRun returns when either:
      // a) All cases are done (run marked 'completed' by runner)
      // b) It self-invoked a continuation (run still 'running')
      // Only update suite if the run is actually finished.
      const run = await ddb.getItem<{ status: string }>(TEST_RUNS_TABLE, { id: runId });
      if (run?.status === 'completed') {
        await ddb.updateItem(TEST_SUITES_TABLE, { id: suiteId }, {
          lastRunStatus: 'completed',
          updatedAt: new Date().toISOString(),
        });
      }
      // If status is still 'running', a continuation Lambda was invoked — do nothing.
    } catch (e) {
      console.error('Test run failed:', e);
      await ddb.updateItem(TEST_RUNS_TABLE, { id: runId }, {
        status: 'failed',
        updatedAt: new Date().toISOString(),
      });
      await ddb.updateItem(TEST_SUITES_TABLE, { id: suiteId }, {
        lastRunStatus: 'failed',
        updatedAt: new Date().toISOString(),
      });
    }
    return { statusCode: 200, body: 'ok' };
  }

  const method = event.requestContext.http.method.toUpperCase();
  if (method === 'OPTIONS') return cors();

  const ctx = await resolveRequestContext(event);
  if (!ctx) return forbidden('Missing tenant identity');
  if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');

  const rawPath = event.rawPath.replace(/^\/dev|^\/prod/, '');
  const suiteIdMatch = rawPath.match(/\/test-suites\/([^/]+)\/run/);
  const suiteId = suiteIdMatch?.[1];
  if (!suiteId) return badRequest('suiteId required');

  try {
    const { v4: uuidv4 } = await import('uuid');

    // Load suite to get assistantId
    const TEST_SUITES_TABLE = process.env['TEST_SUITES_TABLE'] ?? '';
    const TEST_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
    const TEST_CASES_TABLE = process.env['TEST_CASES_TABLE'] ?? '';

    const suite = await ddb.getItem<{ id: string; assistantId: string; tenantId: string }>(
      TEST_SUITES_TABLE, { id: suiteId }
    );
    if (!suite || suite.tenantId !== ctx.organizationId) return notFound('Suite not found');

    // Count enabled cases
    const cases = await ddb.queryItems<{ id: string; enabled: boolean }>(
      TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
    );
    const enabledCount = cases.filter(c => c.enabled).length;
    if (enabledCount === 0) return badRequest('No enabled test cases in this suite');

    // Create run record
    const runId = uuidv4();
    await ddb.putItem(TEST_RUNS_TABLE, {
      id: runId,
      suiteId,
      assistantId: suite.assistantId,
      tenantId: ctx.organizationId,
      status: 'queued',
      totalCases: enabledCount,
      completedCases: 0,
      passedCases: 0,
      failedCases: 0,
      errorCases: 0,
      avgScore: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Update suite with lastRunId so UI can navigate to results
    await ddb.updateItem(TEST_SUITES_TABLE, { id: suiteId }, {
      lastRunId: runId,
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'running',
      updatedAt: new Date().toISOString(),
    });

    // Self-invoke this Lambda asynchronously for the actual test execution.
    // API Gateway Lambdas freeze on response, so fire-and-don't-await won't work.
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    const lambdaClient = new LambdaClient({});
    await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env['TEST_RUNNER_FUNCTION_NAME'] || process.env['AWS_LAMBDA_FUNCTION_NAME'] || '',
      InvocationType: 'Event', // async — returns immediately
      Payload: Buffer.from(JSON.stringify({
        _testRunContinuation: {
          runId,
          suiteId,
          assistantId: suite.assistantId,
          tenantId: ctx.organizationId,
          offset: 0,
        },
      })),
    }));

    return ok({ runId, totalCases: enabledCount, status: 'queued' });
  } catch (e) {
    console.error('Test runner handler error', e);
    return serverError(String(e));
  }
};
