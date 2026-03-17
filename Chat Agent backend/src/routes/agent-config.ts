/**
 * Agent Configuration routes — data guide & system prompt management.
 * Admin-only. Reads/writes the data guide from S3 and the system prompt
 * from both DynamoDB (assistant config) and the Bedrock agent instruction.
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ok, notFound, badRequest, serverError, forbidden } from '../response';
import { IRequestContext, requireRole } from '../auth';
import * as ddb from '../services/dynamo';

const REGION = process.env['REGION'] ?? 'us-west-2';
const CONTENT_BUCKET = process.env['S3_CONTENT_BUCKET'] ?? 'wubba-data-sources';
const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';

const s3 = new S3Client({ region: REGION });

export async function handleAgentConfig(
  method: string,
  rawPath: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  ctx: IRequestContext,
) {
  if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');

  // GET /agent-config/data-guide?assistantId=xxx
  if (rawPath === '/agent-config/data-guide' && method === 'GET') {
    return handleGetDataGuide(query, ctx);
  }

  // PUT /agent-config/data-guide
  if (rawPath === '/agent-config/data-guide' && method === 'PUT') {
    return handlePutDataGuide(body, ctx);
  }

  // GET /agent-config/system-prompt?assistantId=xxx
  if (rawPath === '/agent-config/system-prompt' && method === 'GET') {
    return handleGetSystemPrompt(query, ctx);
  }

  // PUT /agent-config/system-prompt
  if (rawPath === '/agent-config/system-prompt' && method === 'PUT') {
    return handlePutSystemPrompt(body, ctx);
  }

  // GET /agent-config/view-catalog?assistantId=xxx
  if (rawPath === '/agent-config/view-catalog' && method === 'GET') {
    return handleGetViewCatalog(query, ctx);
  }

  // POST /agent-config/ai-revise — use LLM to revise a document based on a prompt
  if (rawPath === '/agent-config/ai-revise' && method === 'POST') {
    return handleAiRevise(body, ctx);
  }

  // GET /agent-config/versions?assistantId=xxx&type=data-guide|system-prompt
  if (rawPath === '/agent-config/versions' && method === 'GET') {
    return handleListVersions(query, ctx);
  }

  // POST /agent-config/revert
  if (rawPath === '/agent-config/revert' && method === 'POST') {
    return handleRevert(body, ctx);
  }

  return notFound('Route not found');
}

// ── AI-Assisted Revision ────────────────────────────────────────────────────

async function handleAiRevise(body: Record<string, unknown>, ctx: IRequestContext) {
  const { document, instruction, documentType, image } = body as {
    document: string;
    instruction: string;
    documentType: 'system-prompt' | 'data-guide';
    image?: string; // base64 data URL (data:image/png;base64,...)
  };

  if (!document || !instruction) return badRequest('document and instruction required');

  try {
    const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const bedrock = new BedrockRuntimeClient({ region: REGION });

    const systemMessage = documentType === 'system-prompt'
      ? `You are an expert at writing system prompts for AI analytics agents. The user will provide the current system prompt for a Bedrock Agent that queries a Snowflake data warehouse for eyecare practice data. Apply the user's requested changes and return the complete revised prompt. Preserve all existing content unless the user explicitly asks to remove something. Keep the same formatting style.`
      : `You are an expert at writing data documentation for AI analytics agents. The user will provide the current data guide (Markdown) that describes a Snowflake data warehouse schema for eyecare practice data. Apply the user's requested changes and return the complete revised document. Preserve all existing content unless the user explicitly asks to remove something. Keep Markdown formatting with headers, tables, and code blocks.`;

    // Build message content — text + optional image
    const userContent: Array<Record<string, unknown>> = [];

    // Add image if provided (screenshot of report, schema, etc.)
    if (image) {
      const match = image.match(/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/);
      if (match) {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: `image/${match[1]}`,
            data: match[2],
          },
        });
      }
    }

    userContent.push({
      type: 'text',
      text: `Here is the current ${documentType === 'system-prompt' ? 'system prompt' : 'data guide'}:\n\n---\n${document}\n---\n\nPlease apply this change:\n${instruction}${image ? '\n\nI have also attached a screenshot — extract any relevant SQL, column names, table names, business logic, or report structure from it and incorporate it into the document.' : ''}\n\nReturn ONLY the complete revised document — no explanations, no markdown wrapping, just the document content.`,
    });

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 16000,
      system: systemMessage,
      messages: [
        {
          role: 'user',
          content: userContent,
        },
      ],
    };

    const response = await bedrock.send(new InvokeModelCommand({
      modelId: 'us.anthropic.claude-sonnet-4-6',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    const revised = result.content?.[0]?.text ?? '';

    return ok({ revised });
  } catch (e) {
    console.error('AI revise error:', e);
    return serverError(String(e));
  }
}

// ── Data Guide (S3) ─────────────────────────────────────────────────────────

async function handleGetDataGuide(query: Record<string, string>, ctx: IRequestContext) {
  const assistantId = query['assistantId'];
  if (!assistantId) return badRequest('assistantId required');

  try {
    const key = `${ctx.organizationId}/${assistantId}/analytics-data-guide.md`;
    const res = await s3.send(new GetObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: key,
    }));
    const content = await res.Body?.transformToString() ?? '';
    return ok({ content, key, lastModified: res.LastModified?.toISOString() });
  } catch (e: any) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      return ok({ content: '', key: '', lastModified: null });
    }
    console.error('Get data guide error:', e);
    return serverError(String(e));
  }
}

const AUDIT_TABLE = process.env['AUDIT_LOG_TABLE'] ?? '';

async function handlePutDataGuide(body: Record<string, unknown>, ctx: IRequestContext) {
  const { assistantId, content } = body as { assistantId: string; content: string };
  if (!assistantId || content === undefined) return badRequest('assistantId and content required');

  try {
    const key = `${ctx.organizationId}/${assistantId}/analytics-data-guide.md`;

    // Save version snapshot before overwriting
    try {
      const prev = await s3.send(new GetObjectCommand({ Bucket: CONTENT_BUCKET, Key: key }));
      const prevContent = await prev.Body?.transformToString() ?? '';
      if (prevContent) {
        const { v4: uuidv4 } = await import('uuid');
        await ddb.putItem(AUDIT_TABLE, {
          id: uuidv4(),
          tenantId: ctx.organizationId,
          action: 'agent-config.data-guide.version',
          assistantId,
          content: prevContent,
          savedBy: ctx.userId,
          createdAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days
        });
      }
    } catch { /* first save, no previous version */ }

    await s3.send(new PutObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: key,
      Body: content,
      ContentType: 'text/markdown',
    }));

    // Trigger KB re-ingestion so the updated guide gets indexed
    try {
      const { BedrockAgentClient, StartIngestionJobCommand, ListDataSourcesCommand } = await import('@aws-sdk/client-bedrock-agent');
      const bedrockAgent = new BedrockAgentClient({ region: REGION });

      const assistant = await ddb.getItem<{ bedrockKnowledgeBaseId?: string }>(
        ASSISTANTS_TABLE, { id: assistantId }
      );
      if (assistant?.bedrockKnowledgeBaseId) {
        const dsRes = await bedrockAgent.send(new ListDataSourcesCommand({
          knowledgeBaseId: assistant.bedrockKnowledgeBaseId,
        }));
        const ds = dsRes.dataSourceSummaries?.[0];
        if (ds) {
          await bedrockAgent.send(new StartIngestionJobCommand({
            knowledgeBaseId: assistant.bedrockKnowledgeBaseId,
            dataSourceId: ds.dataSourceId!,
          }));
        }
      }
    } catch (kbErr) {
      console.warn('KB re-ingestion skipped:', kbErr);
    }

    return ok({ saved: true, key });
  } catch (e) {
    console.error('Put data guide error:', e);
    return serverError(String(e));
  }
}

// ── System Prompt (DynamoDB + Bedrock Agent) ────────────────────────────────

async function handleGetSystemPrompt(query: Record<string, string>, ctx: IRequestContext) {
  const assistantId = query['assistantId'];
  if (!assistantId) return badRequest('assistantId required');

  try {
    const assistant = await ddb.getItem<{
      id: string; tenantId: string; bedrockAgentId?: string;
      modelConfig: { systemPrompt?: string };
    }>(ASSISTANTS_TABLE, { id: assistantId });

    if (!assistant || assistant.tenantId !== ctx.organizationId) return notFound('Assistant not found');

    // Try to get the live Bedrock agent instruction (may differ from DynamoDB)
    let bedrockInstruction = '';
    if (assistant.bedrockAgentId) {
      try {
        const { BedrockAgentClient, GetAgentCommand } = await import('@aws-sdk/client-bedrock-agent');
        const bedrockAgent = new BedrockAgentClient({ region: REGION });
        const agentRes = await bedrockAgent.send(new GetAgentCommand({
          agentId: assistant.bedrockAgentId,
        }));
        bedrockInstruction = agentRes.agent?.instruction ?? '';
      } catch {
        // Bedrock agent may not exist yet
      }
    }

    return ok({
      ddbPrompt: assistant.modelConfig?.systemPrompt ?? '',
      bedrockInstruction,
      bedrockAgentId: assistant.bedrockAgentId ?? '',
    });
  } catch (e) {
    console.error('Get system prompt error:', e);
    return serverError(String(e));
  }
}

async function handlePutSystemPrompt(body: Record<string, unknown>, ctx: IRequestContext) {
  const { assistantId, prompt } = body as { assistantId: string; prompt: string };
  if (!assistantId || prompt === undefined) return badRequest('assistantId and prompt required');

  try {
    const assistant = await ddb.getItem<{
      id: string; tenantId: string; bedrockAgentId?: string;
      modelConfig: Record<string, unknown>;
    }>(ASSISTANTS_TABLE, { id: assistantId });

    if (!assistant || assistant.tenantId !== ctx.organizationId) return notFound('Assistant not found');

    // Save version snapshot
    try {
      const { v4: uuidv4 } = await import('uuid');
      const prevPrompt = assistant.modelConfig?.systemPrompt ?? '';
      if (prevPrompt) {
        await ddb.putItem(AUDIT_TABLE, {
          id: uuidv4(),
          tenantId: ctx.organizationId,
          action: 'agent-config.system-prompt.version',
          assistantId,
          content: prevPrompt,
          savedBy: ctx.userId,
          createdAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
        });
      }
    } catch { /* first save */ }

    // Update DynamoDB
    const updatedConfig = { ...assistant.modelConfig, systemPrompt: prompt };
    await ddb.updateItem(ASSISTANTS_TABLE, { id: assistantId }, {
      modelConfig: updatedConfig,
      updatedAt: new Date().toISOString(),
    });

    // Update Bedrock Agent instruction directly
    let agentUpdated = false;
    if (assistant.bedrockAgentId) {
      try {
        const { BedrockAgentClient, GetAgentCommand, UpdateAgentCommand, PrepareAgentCommand } = await import('@aws-sdk/client-bedrock-agent');
        const bedrockAgent = new BedrockAgentClient({ region: REGION });

        const agentRes = await bedrockAgent.send(new GetAgentCommand({
          agentId: assistant.bedrockAgentId,
        }));
        const agent = agentRes.agent!;

        await bedrockAgent.send(new UpdateAgentCommand({
          agentId: assistant.bedrockAgentId,
          agentName: agent.agentName!,
          agentResourceRoleArn: agent.agentResourceRoleArn!,
          foundationModel: agent.foundationModel!,
          instruction: prompt,
        }));

        await bedrockAgent.send(new PrepareAgentCommand({
          agentId: assistant.bedrockAgentId,
        }));

        agentUpdated = true;
      } catch (agentErr) {
        console.warn('Bedrock agent update failed:', agentErr);
      }
    }

    return ok({ saved: true, agentUpdated });
  } catch (e) {
    console.error('Put system prompt error:', e);
    return serverError(String(e));
  }
}

// ── View Catalog (S3, read-only) ────────────────────────────────────────────

// ── Version History & Revert ────────────────────────────────────────────────

async function handleListVersions(query: Record<string, string>, ctx: IRequestContext) {
  const { assistantId, type } = query;
  if (!assistantId || !type) return badRequest('assistantId and type required');

  const action = type === 'system-prompt'
    ? 'agent-config.system-prompt.version'
    : 'agent-config.data-guide.version';

  try {
    const versions = await ddb.queryItems<{
      id: string; createdAt: string; savedBy: string; content: string;
    }>(
      AUDIT_TABLE,
      '#action = :action AND tenantId = :tid',
      { ':action': action, ':tid': ctx.organizationId },
      { '#action': 'action' },
    );

    // Filter by assistantId and sort by date
    const filtered = versions
      .filter((v: any) => v.assistantId === assistantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map(v => ({
        id: v.id,
        createdAt: v.createdAt,
        savedBy: v.savedBy,
        preview: v.content.slice(0, 200) + (v.content.length > 200 ? '...' : ''),
        size: v.content.length,
      }));

    return ok(filtered);
  } catch (e) {
    console.error('List versions error:', e);
    return serverError(String(e));
  }
}

async function handleRevert(body: Record<string, unknown>, ctx: IRequestContext) {
  const { versionId } = body as { versionId: string };
  if (!versionId) return badRequest('versionId required');

  try {
    const version = await ddb.getItem<{
      id: string; tenantId: string; action: string; assistantId: string; content: string;
    }>(AUDIT_TABLE, { id: versionId });

    if (!version || version.tenantId !== ctx.organizationId) return notFound('Version not found');

    return ok({ content: version.content });
  } catch (e) {
    console.error('Revert error:', e);
    return serverError(String(e));
  }
}

// ── View Catalog (S3, read-only) ────────────────────────────────────────────

async function handleGetViewCatalog(query: Record<string, string>, ctx: IRequestContext) {
  const assistantId = query['assistantId'];
  if (!assistantId) return badRequest('assistantId required');

  try {
    const key = `${ctx.organizationId}/${assistantId}/snowflake-view-catalog.md`;
    const res = await s3.send(new GetObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: key,
    }));
    const content = await res.Body?.transformToString() ?? '';
    return ok({ content, lastModified: res.LastModified?.toISOString() });
  } catch (e: any) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      return ok({ content: 'No view catalog found. Run the extraction script to generate it.', lastModified: null });
    }
    return serverError(String(e));
  }
}
