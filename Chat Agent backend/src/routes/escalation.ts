import { APIGatewayProxyResultV2 } from 'aws-lambda';
import * as ddb from '../services/dynamo';
import * as salesforce from '../services/salesforce';
import * as hipaaS3 from '../services/hipaa-s3';
import { ok, created, noContent, badRequest, forbidden, notFound, serverError, unauthorized } from '../response';
import { IRequestContext, requireRole, parseBody } from '../auth';
import { findAssistantByApiKey } from './widget-chat';

const ESCALATION_TABLE = process.env['ESCALATION_CONFIG_TABLE'] ?? '';
const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';
const ATTACHMENTS_TABLE = process.env['ATTACHMENTS_TABLE'] ?? '';

export interface IEscalationConfig {
  assistantId: string;
  tenantId: string;
  enabled: boolean;
  salesforceInstanceUrl: string;
  salesforceConsumerKey: string;
  salesforceUsername: string;
  ssmPrivateKeyParam: string;
  triggerMode: 'manual' | 'auto' | 'both';
  autoTriggers: {
    keywords: string[];
    sentimentThreshold?: number;
    maxTurns?: number;
  };
  caseDefaults: {
    priority: string;
    origin: string;
    status: string;
    recordTypeId?: string;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Authenticated escalation config endpoints — admin only.
 */
export async function handleEscalation(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  _query: Record<string, string>,
  ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  const tenantId = ctx.organizationId;
  try {
    // Extract assistantId from path: /escalation/config/:assistantId or /escalation/test-connection/:assistantId
    const segments = path.split('/');
    const assistantId = params['id'] ?? segments[segments.length - 1];

    // GET /escalation/config/:assistantId
    if (method === 'GET' && path.includes('/config/')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const config = await ddb.getItem<IEscalationConfig>(ESCALATION_TABLE, { assistantId });
      if (!config) return ok(null);
      if (config.tenantId !== tenantId) return forbidden();
      // Never return the SSM param name directly — just indicate whether key is stored
      return ok({ ...config, hasPrivateKey: !!config.ssmPrivateKeyParam, ssmPrivateKeyParam: undefined });
    }

    // PUT /escalation/config/:assistantId
    if (method === 'PUT' && path.includes('/config/')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const b = parseBody<{
        enabled: boolean;
        salesforceInstanceUrl: string;
        salesforceConsumerKey: string;
        salesforceUsername: string;
        privateKey?: string;
        triggerMode: 'manual' | 'auto' | 'both';
        autoTriggers: { keywords: string[]; sentimentThreshold?: number; maxTurns?: number };
        caseDefaults: { priority: string; origin: string; status: string; recordTypeId?: string };
      }>(JSON.stringify(body));
      if (!b) return badRequest('Invalid body');

      const ssmParamName = `/chat-agent/dev/salesforce/${assistantId}/private-key`;

      // Store private key in SSM if provided
      if (b.privateKey) {
        await salesforce.storePrivateKey(ssmParamName, b.privateKey);
      }

      const now = new Date().toISOString();
      const existing = await ddb.getItem<IEscalationConfig>(ESCALATION_TABLE, { assistantId });

      const config: IEscalationConfig = {
        assistantId,
        tenantId,
        enabled: b.enabled,
        salesforceInstanceUrl: b.salesforceInstanceUrl,
        salesforceConsumerKey: b.salesforceConsumerKey,
        salesforceUsername: b.salesforceUsername,
        ssmPrivateKeyParam: b.privateKey ? ssmParamName : (existing?.ssmPrivateKeyParam ?? ''),
        triggerMode: b.triggerMode,
        autoTriggers: b.autoTriggers ?? { keywords: [] },
        caseDefaults: b.caseDefaults ?? { priority: 'Medium', origin: 'Chat', status: 'New' },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await ddb.putItem(ESCALATION_TABLE, config as unknown as Record<string, unknown>);
      return ok({ ...config, hasPrivateKey: !!config.ssmPrivateKeyParam, ssmPrivateKeyParam: undefined });
    }

    // DELETE /escalation/config/:assistantId
    if (method === 'DELETE' && path.includes('/config/')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const config = await ddb.getItem<IEscalationConfig>(ESCALATION_TABLE, { assistantId });
      if (config) {
        if (config.tenantId !== tenantId) return forbidden();
        if (config.ssmPrivateKeyParam) {
          await salesforce.deletePrivateKey(config.ssmPrivateKeyParam);
        }
        await ddb.deleteItem(ESCALATION_TABLE, { assistantId });
      }
      return noContent();
    }

    // POST /escalation/test-connection/:assistantId
    if (method === 'POST' && path.includes('/test-connection/')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const config = await ddb.getItem<IEscalationConfig>(ESCALATION_TABLE, { assistantId });
      if (!config) return notFound('No escalation config found');
      if (config.tenantId !== tenantId) return forbidden();
      if (!config.ssmPrivateKeyParam) return badRequest('No private key configured');

      try {
        const token = await salesforce.getAccessToken({
          instanceUrl: config.salesforceInstanceUrl,
          consumerKey: config.salesforceConsumerKey,
          username: config.salesforceUsername,
          ssmPrivateKeyParam: config.ssmPrivateKeyParam,
        });
        return ok({ success: true, instanceUrl: token.instanceUrl });
      } catch (e) {
        return ok({ success: false, error: String(e) });
      }
    }

    return notFound();
  } catch (e) {
    console.error('escalation handler error', e);
    return serverError(String(e));
  }
}

/**
 * Public widget escalation endpoint — authenticated via API key.
 * Creates a Salesforce Case with the chat transcript.
 */
export async function handleWidgetEscalation(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const b = parseBody<{
      chatHistory: Array<{ role: string; content: string; timestamp?: string }>;
      sessionId?: string;
      context?: Record<string, string>;
      userInfo?: { name?: string; email?: string; phone?: string };
      reason?: string;
      attachmentIds?: string[];
    }>(JSON.stringify(body));
    if (!b?.chatHistory?.length) return badRequest('chatHistory is required');

    // Look up assistant by API key (uses GSI with scan fallback)
    const assistant = await findAssistantByApiKey(apiKey) as {
      id: string; tenantId: string; status: string; apiKey: string; name: string;
    } | null;
    if (!assistant) return unauthorized('Invalid API key');

    // Load escalation config
    const config = await ddb.getItem<IEscalationConfig>(ESCALATION_TABLE, { assistantId: assistant.id });
    if (!config?.enabled) return badRequest('Escalation is not enabled for this assistant');
    if (!config.ssmPrivateKeyParam) return badRequest('Salesforce not configured');

    // Get Salesforce access token
    const token = await salesforce.getAccessToken({
      instanceUrl: config.salesforceInstanceUrl,
      consumerKey: config.salesforceConsumerKey,
      username: config.salesforceUsername,
      ssmPrivateKeyParam: config.ssmPrivateKeyParam,
    });

    // Format chat transcript
    const transcript = b.chatHistory
      .map(m => `[${m.role}${m.timestamp ? ` ${m.timestamp}` : ''}]: ${m.content}`)
      .join('\n');

    // Format context data
    const contextStr = b.context
      ? Object.entries(b.context).map(([k, v]) => `${k}: ${v}`).join('\n')
      : '';

    const userInfoStr = b.userInfo
      ? Object.entries(b.userInfo).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
      : '';

    // Generate presigned download URLs for attachments (15-min expiry)
    let attachmentSection = '';
    if (b.attachmentIds?.length && ATTACHMENTS_TABLE) {
      const attachmentUrls: string[] = [];
      for (const attId of b.attachmentIds) {
        const att = await ddb.getItem<{ id: string; s3Key: string; fileName: string; status: string }>(
          ATTACHMENTS_TABLE, { id: attId },
        );
        if (att?.status === 'confirmed' && att.s3Key) {
          const url = await hipaaS3.getHipaaDownloadUrl(att.s3Key, 900);
          attachmentUrls.push(`${att.fileName}: ${url}`);
        }
      }
      if (attachmentUrls.length > 0) {
        attachmentSection = `\n--- Attachments (links expire in 15 min) ---\n${attachmentUrls.join('\n')}`;
      }
    }

    const description = [
      `=== Chat Escalation ===`,
      `Assistant: ${assistant.name}`,
      `Session: ${b.sessionId ?? 'N/A'}`,
      b.reason ? `Reason: ${b.reason}` : '',
      userInfoStr ? `\n--- User Info ---\n${userInfoStr}` : '',
      contextStr ? `\n--- Page Context ---\n${contextStr}` : '',
      `\n--- Chat Transcript ---\n${transcript}`,
      attachmentSection,
    ].filter(Boolean).join('\n');

    const caseResult = await salesforce.createCase(token.accessToken, token.instanceUrl, {
      Subject: `Chat Escalation: ${assistant.name}${b.reason ? ` - ${b.reason}` : ''}`,
      Description: description,
      Priority: config.caseDefaults.priority || 'Medium',
      Origin: config.caseDefaults.origin || 'Chat',
      Status: config.caseDefaults.status || 'New',
      ...(config.caseDefaults.recordTypeId ? { RecordTypeId: config.caseDefaults.recordTypeId } : {}),
    });

    return ok({
      success: true,
      caseId: caseResult.id,
      caseNumber: caseResult.caseNumber,
    });
  } catch (e) {
    console.error('widget escalation error', e);
    return serverError(String(e));
  }
}

/**
 * Public widget auto-escalation check — analyzes last messages for triggers.
 */
export async function handleWidgetCheckEscalation(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const b = parseBody<{
      messages: Array<{ role: string; content: string }>;
      turnCount?: number;
    }>(JSON.stringify(body));
    if (!b?.messages?.length) return badRequest('messages is required');

    // Look up assistant by API key (uses GSI with scan fallback)
    const assistant = await findAssistantByApiKey(apiKey);
    if (!assistant) return unauthorized('Invalid API key');

    const config = await ddb.getItem<IEscalationConfig>(ESCALATION_TABLE, { assistantId: assistant.id });
    if (!config?.enabled) return ok({ shouldEscalate: false });
    if (config.triggerMode === 'manual') return ok({ shouldEscalate: false });

    // Check keyword triggers
    const lastMessages = b.messages.slice(-3);
    const allText = lastMessages.map(m => m.content.toLowerCase()).join(' ');
    const triggeredKeyword = config.autoTriggers.keywords?.find(kw => allText.includes(kw.toLowerCase()));

    // Check max turns
    const maxTurnsExceeded = config.autoTriggers.maxTurns
      ? (b.turnCount ?? b.messages.length) >= config.autoTriggers.maxTurns
      : false;

    const shouldEscalate = !!triggeredKeyword || maxTurnsExceeded;
    return ok({
      shouldEscalate,
      reason: triggeredKeyword ? `Keyword detected: ${triggeredKeyword}` : (maxTurnsExceeded ? 'Max turns exceeded' : undefined),
    });
  } catch (e) {
    console.error('check-escalation error', e);
    return serverError(String(e));
  }
}
