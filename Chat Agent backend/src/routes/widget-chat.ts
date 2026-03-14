import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import * as bedrockChat from '../services/bedrock-chat';
import { ok, badRequest, unauthorized, notFound, serverError } from '../response';
import { parseBody, resolveNodeRole } from '../auth';

const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';
const NODE_USERS_TABLE = process.env['NODE_USERS_TABLE'] ?? '';
const ASSISTANT_KB_TABLE = process.env['ASSISTANT_KB_TABLE'] ?? '';
const KB_DEFS_TABLE = process.env['KNOWLEDGE_BASES_TABLE'] ?? '';
const METRICS_TABLE = process.env['METRICS_TABLE'] ?? '';
const CHAT_JOBS_TABLE = process.env['CHAT_JOBS_TABLE'] ?? '';
const CHAT_WORKER_FUNCTION = process.env['CHAT_WORKER_FUNCTION_NAME'] ?? '';

interface IWidgetAssistant {
  id: string;
  tenantId: string;
  status: string;
  apiKey: string;
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
  bedrockKnowledgeBaseId?: string;
}

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
  bedrockKnowledgeBaseId?: string;
}

/**
 * Look up an assistant by its API key using the apiKey-index GSI.
 * Falls back to a table scan if the GSI is not yet deployed.
 */
export async function findAssistantByApiKey(apiKey: string): Promise<IWidgetAssistant | null> {
  try {
    const items = await ddb.queryItems<IWidgetAssistant>(
      ASSISTANTS_TABLE,
      'apiKey = :ak',
      { ':ak': apiKey },
      undefined,
      'apiKey-index',
    );
    return items[0] ?? null;
  } catch {
    // Fallback: GSI may not exist yet — use scan
    const items = await ddb.scanItems<IWidgetAssistant>(
      ASSISTANTS_TABLE,
      'apiKey = :ak',
      { ':ak': apiKey },
    );
    return items[0] ?? null;
  }
}

/**
 * Public widget chat — authenticates via x-api-key header instead of JWT.
 * Looks up the assistant by API key, then invokes the Bedrock agent.
 */
export async function handleWidgetChat(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const b = parseBody<{
      message: string; sessionId?: string; userId?: string; nodeId?: string;
      image?: string; context?: Record<string, string>;
    }>(JSON.stringify(body));
    if (!b?.message?.trim() && !b?.image) return badRequest('message or image is required');

    const assistant = await findAssistantByApiKey(apiKey);
    if (!assistant) return unauthorized('Invalid API key');
    if (assistant.status !== 'ready') return badRequest('Assistant is not ready');
    if (!assistant.bedrockAgentId || !assistant.bedrockAgentAliasId) {
      return badRequest('Assistant has no Bedrock agent');
    }

    // Resolve role from userId if provided
    let roleLevel: number | undefined;
    if (b.userId) {
      const nodeUser = await ddb.getItem<{ userId: string; role: string }>(
        NODE_USERS_TABLE, { userId: b.userId },
      );
      roleLevel = nodeUser ? resolveNodeRole(nodeUser.role) : 0;
    }

    // Collect all linked KB Bedrock IDs for role filtering
    let kbIdsForFilter: string[] = [];
    if (ASSISTANT_KB_TABLE) {
      const links = await ddb.queryItems<IAssistantKbLink>(
        ASSISTANT_KB_TABLE, 'assistantId = :a', { ':a': assistant.id },
      );
      for (const link of links) {
        const kbDef = await ddb.getItem<IKbDef>(KB_DEFS_TABLE, { id: link.knowledgeBaseId });
        if (kbDef?.bedrockKnowledgeBaseId) kbIdsForFilter.push(kbDef.bedrockKnowledgeBaseId);
      }
    }
    // Fallback to legacy single KB if no linked KB defs
    if (kbIdsForFilter.length === 0 && assistant.bedrockKnowledgeBaseId) {
      kbIdsForFilter = [assistant.bedrockKnowledgeBaseId];
    }

    const roleFilter = (roleLevel !== undefined && kbIdsForFilter.length > 0)
      ? { knowledgeBaseIds: kbIdsForFilter, roleLevel }
      : undefined;

    // Build the message to send to the agent
    let finalMessage = (b.message || '').trim();

    // If image is provided, describe it with vision model first
    if (b.image) {
      const imageDescription = await bedrockChat.describeImage(
        b.image, b.message || undefined,
      );
      finalMessage = `[User sent an image. Image description: ${imageDescription}]\n\nUser's message: ${b.message || 'What can you tell me about this image?'}`;
    }

    // Prepend context data if provided
    if (b.context && Object.keys(b.context).length > 0) {
      const pageKeys = ['getUrl', 'pageTitle', 'breadcrumb', 'getPageTitle', 'getBreadcrumb'];
      const pageEntries = Object.entries(b.context).filter(([k]) => pageKeys.includes(k));
      const otherEntries = Object.entries(b.context).filter(([k]) => !pageKeys.includes(k));

      const sections: string[] = [];
      if (pageEntries.length > 0) {
        sections.push('User is currently on this page:');
        for (const [k, v] of pageEntries) {
          const label = k === 'getUrl' ? 'URL' : k === 'getPageTitle' || k === 'pageTitle' ? 'Page Title' : k === 'getBreadcrumb' || k === 'breadcrumb' ? 'Breadcrumb' : k;
          sections.push(`${label}: ${v}`);
        }
        sections.push('');
        sections.push('Use this context to tailor your response to what the user is likely doing.');
      }
      if (otherEntries.length > 0) {
        if (sections.length > 0) sections.push('');
        sections.push('Additional context:');
        for (const [k, v] of otherEntries) {
          sections.push(`${k}: ${v}`);
        }
      }
      finalMessage = `[${sections.join('\n')}]\n\n${finalMessage}`;
    }

    const sessionId = b.sessionId ?? uuidv4();

    // Async dispatch: create a job, invoke worker Lambda, return jobId immediately
    const jobId = uuidv4();
    await ddb.putItem(CHAT_JOBS_TABLE, {
      id: jobId,
      status: 'processing',
      assistantId: assistant.id,
      tenantId: assistant.tenantId,
      sessionId,
      query: (b.message || '').trim(),
      createdAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 3600, // auto-expire after 1 hour
    });

    // Fire-and-forget: invoke worker Lambda asynchronously
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    const lambdaClient = new LambdaClient({});
    await lambdaClient.send(new InvokeCommand({
      FunctionName: CHAT_WORKER_FUNCTION,
      InvocationType: 'Event', // async — returns immediately
      Payload: Buffer.from(JSON.stringify({
        _chatJob: {
          jobId,
          agentId: assistant.bedrockAgentId,
          agentAliasId: assistant.bedrockAgentAliasId,
          message: finalMessage,
          sessionId,
          roleFilter,
          assistantId: assistant.id,
          tenantId: assistant.tenantId,
          userQuery: (b.message || '').trim(),
        },
      })),
    }));

    return ok({
      success: true,
      data: {
        jobId,
        sessionId,
        status: 'processing',
      },
    });
  } catch (e) {
    console.error('widget chat error', e);
    return serverError(String(e));
  }
}

/**
 * Poll for chat job result — called by GET /widget/chat/:jobId
 */
export async function handleWidgetChatPoll(
  jobId: string,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const assistant = await findAssistantByApiKey(apiKey);
    if (!assistant) return unauthorized('Invalid API key');

    const job = await ddb.getItem<{
      id: string; status: string; assistantId: string;
      sessionId: string; reply?: string; metricId?: string;
      actionGroupCalls?: unknown[]; error?: string;
    }>(CHAT_JOBS_TABLE, { id: jobId });

    if (!job) return notFound('Job not found');
    if (job.assistantId !== assistant.id) return unauthorized('Job does not belong to this assistant');

    if (job.status === 'processing') {
      return ok({ success: true, data: { jobId, status: 'processing' } });
    }

    if (job.status === 'failed') {
      return ok({ success: true, data: { jobId, status: 'failed', error: job.error || 'Unknown error' } });
    }

    // status === 'complete'
    return ok({
      success: true,
      data: {
        jobId,
        status: 'complete',
        reply: job.reply,
        sessionId: job.sessionId,
        metricId: job.metricId,
        ...(job.actionGroupCalls && { actionGroupCalls: job.actionGroupCalls }),
      },
    });
  } catch (e) {
    console.error('widget chat poll error', e);
    return serverError(String(e));
  }
}

/**
 * Process a chat job — invoked async by the worker Lambda.
 * Calls Bedrock agent, writes result to DynamoDB.
 */
export async function processChatJob(job: {
  jobId: string; agentId: string; agentAliasId: string;
  message: string; sessionId: string; roleFilter?: any;
  assistantId: string; tenantId: string; userQuery: string;
}): Promise<void> {
  try {
    const agentResult = await bedrockChat.invokeAgent(
      job.agentId,
      job.agentAliasId,
      job.message,
      job.sessionId,
      job.roleFilter,
    );

    const reply = agentResult.text;

    // Write metrics
    let metricId: string | undefined;
    try {
      metricId = uuidv4();
      await ddb.putItem(METRICS_TABLE, {
        id: metricId,
        assistantId: job.assistantId,
        tenantId: job.tenantId,
        sessionId: job.sessionId,
        query: job.userQuery,
        responseLength: reply.length,
        guardrailTriggered: false,
        videoCited: /video|vimeo|youtube/i.test(reply),
        satisfied: null,
        source: 'widget',
        createdAt: new Date().toISOString(),
      });
    } catch (metricErr) {
      console.error('metrics write error (non-critical)', metricErr);
    }

    // Write result to DynamoDB
    await ddb.updateItem(CHAT_JOBS_TABLE, { id: job.jobId }, {
      status: 'complete',
      reply,
      metricId,
      ...(agentResult.actionGroupCalls && { actionGroupCalls: agentResult.actionGroupCalls }),
      completedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('chat job processing error', e);
    await ddb.updateItem(CHAT_JOBS_TABLE, { id: job.jobId }, {
      status: 'failed',
      error: String(e),
      completedAt: new Date().toISOString(),
    });
  }
}

const REPORT_BUCKET = process.env['REPORT_BUCKET'] ?? 'snowflake-eyecare-reports-dev';
const PRESIGN_EXPIRY = 900; // 15 minutes

/**
 * Secure file download — validates API key, generates a presigned S3 URL, returns 302 redirect.
 * Called by GET /widget/download/{key+}
 */
export async function handleWidgetDownload(
  s3Key: string,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const assistant = await findAssistantByApiKey(apiKey);
    if (!assistant) return unauthorized('Invalid API key');

    // Validate the key is within the reports/ prefix (prevent path traversal)
    if (!s3Key.startsWith('reports/')) {
      return badRequest('Invalid download path');
    }

    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const s3 = new S3Client({ region: process.env['REGION'] ?? 'us-west-2' });
    const presignedUrl = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: REPORT_BUCKET,
      Key: s3Key,
    }), { expiresIn: PRESIGN_EXPIRY });

    return {
      statusCode: 302,
      headers: {
        Location: presignedUrl,
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  } catch (e) {
    console.error('widget download error', e);
    return serverError(String(e));
  }
}
