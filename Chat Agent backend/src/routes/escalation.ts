import { APIGatewayProxyResultV2 } from 'aws-lambda';
import * as ddb from '../services/dynamo';
import * as salesforce from '../services/salesforce';
import * as hipaaS3 from '../services/hipaa-s3';
import { ok, created, noContent, badRequest, forbidden, notFound, serverError, unauthorized } from '../response';
import { IRequestContext, requireRole, parseBody } from '../auth';
import { findAssistantByApiKey } from './widget-chat';
import { analyzeTranscript } from '../services/case-analyzer';

const ESCALATION_TABLE = process.env['ESCALATION_CONFIG_TABLE'] ?? '';
const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';
const ATTACHMENTS_TABLE = process.env['ATTACHMENTS_TABLE'] ?? '';

export interface IEscalationConfig {
  assistantId: string;
  tenantId: string;
  enabled: boolean;
  authMode: 'jwt' | 'password';
  // JWT flow fields
  salesforceInstanceUrl: string;
  salesforceConsumerKey: string;
  salesforceUsername: string;
  ssmPrivateKeyParam: string;
  // Password flow fields
  salesforceLoginUrl?: string;
  salesforceClientId?: string;
  ssmPasswordCredentialsParam?: string;
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
  customFieldMapping?: {
    enabled: boolean;
    fields: string[];
  };
  aiAnalysisEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get Salesforce access token using the configured auth mode (JWT or password).
 */
async function getSalesforceToken(config: IEscalationConfig): Promise<{ accessToken: string; instanceUrl: string }> {
  if (config.authMode === 'password') {
    if (!config.ssmPasswordCredentialsParam) throw new Error('Password credentials not configured');
    return salesforce.getAccessTokenPasswordFlow(
      {
        loginUrl: config.salesforceLoginUrl || config.salesforceInstanceUrl,
        clientId: config.salesforceClientId || config.salesforceConsumerKey,
        ssmCredentialsParam: config.ssmPasswordCredentialsParam,
      },
      config.salesforceUsername,
    );
  }
  // Default: JWT flow
  if (!config.ssmPrivateKeyParam) throw new Error('Private key not configured');
  return salesforce.getAccessToken({
    instanceUrl: config.salesforceInstanceUrl,
    consumerKey: config.salesforceConsumerKey,
    username: config.salesforceUsername,
    ssmPrivateKeyParam: config.ssmPrivateKeyParam,
  });
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
      // Never return SSM param names — just indicate whether credentials are stored
      return ok({
        ...config,
        hasPrivateKey: !!config.ssmPrivateKeyParam,
        hasPasswordCredentials: !!config.ssmPasswordCredentialsParam,
        ssmPrivateKeyParam: undefined,
        ssmPasswordCredentialsParam: undefined,
      });
    }

    // PUT /escalation/config/:assistantId
    if (method === 'PUT' && path.includes('/config/')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const b = parseBody<{
        enabled: boolean;
        authMode?: 'jwt' | 'password';
        salesforceInstanceUrl: string;
        salesforceConsumerKey: string;
        salesforceUsername: string;
        privateKey?: string;
        // Password flow fields
        salesforceLoginUrl?: string;
        salesforceClientId?: string;
        salesforceClientSecret?: string;
        salesforcePassword?: string;
        salesforceSecurityToken?: string;
        triggerMode: 'manual' | 'auto' | 'both';
        autoTriggers: { keywords: string[]; sentimentThreshold?: number; maxTurns?: number };
        caseDefaults: { priority: string; origin: string; status: string; recordTypeId?: string };
        customFieldMapping?: { enabled: boolean; fields: string[] };
        aiAnalysisEnabled?: boolean;
      }>(JSON.stringify(body));
      if (!b) return badRequest('Invalid body');

      const existing = await ddb.getItem<IEscalationConfig>(ESCALATION_TABLE, { assistantId });
      const now = new Date().toISOString();
      const authMode = b.authMode ?? existing?.authMode ?? 'jwt';

      // Store JWT private key in SSM if provided
      const ssmKeyParam = `/chat-agent/dev/salesforce/${assistantId}/private-key`;
      if (b.privateKey) {
        await salesforce.storePrivateKey(ssmKeyParam, b.privateKey);
      }

      // Store password credentials in SSM if provided
      const ssmCredsParam = `/chat-agent/dev/salesforce/${assistantId}/password-creds`;
      if (b.salesforcePassword) {
        await salesforce.storePasswordCredentials(ssmCredsParam, {
          clientSecret: b.salesforceClientSecret ?? '',
          password: b.salesforcePassword,
          securityToken: b.salesforceSecurityToken ?? '',
        });
      }

      const config: IEscalationConfig = {
        assistantId,
        tenantId,
        enabled: b.enabled,
        authMode,
        salesforceInstanceUrl: b.salesforceInstanceUrl,
        salesforceConsumerKey: b.salesforceConsumerKey,
        salesforceUsername: b.salesforceUsername,
        ssmPrivateKeyParam: b.privateKey ? ssmKeyParam : (existing?.ssmPrivateKeyParam ?? ''),
        salesforceLoginUrl: b.salesforceLoginUrl ?? existing?.salesforceLoginUrl,
        salesforceClientId: b.salesforceClientId ?? existing?.salesforceClientId,
        ssmPasswordCredentialsParam: b.salesforcePassword ? ssmCredsParam : (existing?.ssmPasswordCredentialsParam ?? ''),
        triggerMode: b.triggerMode,
        autoTriggers: b.autoTriggers ?? { keywords: [] },
        caseDefaults: b.caseDefaults ?? { priority: 'Medium', origin: 'Chat', status: 'New' },
        customFieldMapping: b.customFieldMapping ?? existing?.customFieldMapping,
        aiAnalysisEnabled: b.aiAnalysisEnabled ?? existing?.aiAnalysisEnabled ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await ddb.putItem(ESCALATION_TABLE, config as unknown as Record<string, unknown>);
      return ok({
        ...config,
        hasPrivateKey: !!config.ssmPrivateKeyParam,
        hasPasswordCredentials: !!config.ssmPasswordCredentialsParam,
        ssmPrivateKeyParam: undefined,
        ssmPasswordCredentialsParam: undefined,
      });
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
      try {
        const token = await getSalesforceToken(config);
        // Also detect available custom fields
        let customFields: string[] = [];
        try {
          customFields = await salesforce.getCaseFieldMetadata(token.accessToken, token.instanceUrl);
        } catch { /* non-critical */ }
        return ok({ success: true, instanceUrl: token.instanceUrl, customFields });
      } catch (e) {
        // Return diagnostic info to help troubleshoot
        const diagnostic: Record<string, unknown> = {
          authMode: config.authMode,
          instanceUrl: config.salesforceInstanceUrl,
          username: config.salesforceUsername,
          consumerKeyPrefix: config.salesforceConsumerKey?.substring(0, 20) + '...',
          hasPrivateKey: !!config.ssmPrivateKeyParam,
          hasPasswordCreds: !!config.ssmPasswordCredentialsParam,
        };
        return ok({ success: false, error: String(e), diagnostic });
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
      diagnostics?: {
        userAgent?: string;
        platform?: string;
        language?: string;
        screenResolution?: string;
        viewport?: string;
        cookiesEnabled?: boolean;
        onlineStatus?: boolean;
        timestamp?: string;
        // Encompass / Eyefinity host app fields
        hostApp?: string;
        hostAppVersion?: string;
        encompassUser?: string;
        encompassUserId?: string;
        officeNumber?: string;
        companyId?: string;
        officeId?: string;
        ehrEnabled?: string;
        trainingMode?: string;
        currentRoute?: string;
        currentPath?: string;
        loginName?: string;
        practiceLocationId?: string;
      };
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
    if (!config.ssmPrivateKeyParam && !config.ssmPasswordCredentialsParam) return badRequest('Salesforce not configured');

    // Get Salesforce access token (JWT or password flow)
    const token = await getSalesforceToken(config);

    // ── AI-powered case analysis (if enabled) ─────────────────────

    let aiSubject = '';
    let aiPriority = '';
    let aiSummary = '';
    let aiCategory = '';

    if (config.aiAnalysisEnabled) {
      try {
        const analysis = await analyzeTranscript(b.chatHistory, assistant.name);
        aiSubject = analysis.subject;
        aiPriority = analysis.priority;
        aiSummary = analysis.summary;
        aiCategory = analysis.category;
      } catch (err) {
        console.warn('AI analysis failed, using defaults:', err);
      }
    }

    // ── Build structured case description ──────────────────────────

    const now = new Date().toISOString();
    const diag = b.diagnostics ?? {};
    const ctx = b.context ?? {};

    // Format chat transcript with timestamps
    const transcript = b.chatHistory
      .map(m => {
        const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const role = m.role === 'user' ? 'User' : 'Assistant';
        return `[${role}${ts ? ' ' + ts : ''}]: ${m.content}`;
      })
      .join('\n');

    // Generate presigned download URLs for attachments (15-min expiry)
    const attachmentLines: string[] = [];
    if (b.attachmentIds?.length && ATTACHMENTS_TABLE) {
      for (const attId of b.attachmentIds) {
        const att = await ddb.getItem<{ id: string; s3Key: string; fileName: string; status: string }>(
          ATTACHMENTS_TABLE, { id: attId },
        );
        if (att?.status === 'confirmed' && att.s3Key) {
          const url = await hipaaS3.getHipaaDownloadUrl(att.s3Key, 900);
          attachmentLines.push(`\u2022 ${att.fileName}: ${url}`);
        }
      }
    }

    // Build structured description (borrowed from SupportCaseManager pattern)
    const sections: string[] = [
      `\u2550\u2550\u2550 CHAT ESCALATION \u2550\u2550\u2550`,
      `Assistant: ${assistant.name}  |  Session: ${b.sessionId ?? 'N/A'}  |  ${now}`,
      b.reason ? `Reason: ${b.reason}` : '',
      aiCategory ? `Category: ${aiCategory}` : '',
    ];

    // AI-generated summary (if available)
    if (aiSummary) {
      sections.push('', '--- CONVERSATION SUMMARY ---', aiSummary);
    }

    // User info section
    if (b.userInfo?.name || b.userInfo?.email || b.userInfo?.phone) {
      sections.push('', '--- USER INFORMATION ---');
      if (b.userInfo.name) sections.push(`\u2022 Name: ${b.userInfo.name}`);
      if (b.userInfo.email) sections.push(`\u2022 Email: ${b.userInfo.email}`);
      if (b.userInfo.phone) sections.push(`\u2022 Phone: ${b.userInfo.phone}`);
    }

    // Page context section
    if (ctx.getUrl || ctx.pageTitle || ctx.breadcrumb || ctx.getPageTitle || ctx.getBreadcrumb) {
      sections.push('', '--- PAGE CONTEXT ---');
      if (ctx.getUrl) sections.push(`\u2022 URL: ${ctx.getUrl}`);
      if (ctx.pageTitle || ctx.getPageTitle) sections.push(`\u2022 Page Title: ${ctx.pageTitle || ctx.getPageTitle}`);
      if (ctx.breadcrumb || ctx.getBreadcrumb) sections.push(`\u2022 Breadcrumb: ${ctx.breadcrumb || ctx.getBreadcrumb}`);
    }

    // Environment section (from browser diagnostics)
    if (diag.userAgent || diag.screenResolution || diag.platform) {
      sections.push('', '--- ENVIRONMENT ---');
      if (diag.userAgent) sections.push(`\u2022 Browser: ${diag.userAgent}`);
      if (diag.platform) sections.push(`\u2022 Platform: ${diag.platform}`);
      if (diag.screenResolution) sections.push(`\u2022 Screen: ${diag.screenResolution}`);
      if (diag.viewport) sections.push(`\u2022 Viewport: ${diag.viewport}`);
      if (diag.language) sections.push(`\u2022 Language: ${diag.language}`);
      if (diag.onlineStatus !== undefined) sections.push(`\u2022 Online: ${diag.onlineStatus}`);
    }

    // Encompass / Eyefinity host app section
    if (diag.hostApp) {
      sections.push('', '--- HOST APPLICATION ---');
      sections.push(`• App: ${diag.hostApp} v${diag.hostAppVersion || 'unknown'}`);
      if (diag.encompassUser) sections.push(`• User: ${diag.encompassUser} (ID: ${diag.encompassUserId || 'N/A'})`);
      if (diag.officeNumber) sections.push(`• Office #: ${diag.officeNumber}`);
      if (diag.companyId) sections.push(`• Company: ${diag.companyId}`);
      if (diag.officeId) sections.push(`• Office ID: ${diag.officeId}`);
      if (diag.loginName) sections.push(`• Login: ${diag.loginName}`);
      if (diag.practiceLocationId) sections.push(`• Practice Location: ${diag.practiceLocationId}`);
      if (diag.ehrEnabled) sections.push(`• EHR Enabled: ${diag.ehrEnabled}`);
      if (diag.trainingMode) sections.push(`• Training Mode: ${diag.trainingMode}`);
      if (diag.currentRoute || diag.currentPath) sections.push(`• Current Route: ${diag.currentRoute || diag.currentPath}`);
    }

    // Other custom context (excluding page keys and host app keys already shown)
    const pageKeys = new Set(['getUrl', 'pageTitle', 'breadcrumb', 'getPageTitle', 'getBreadcrumb',
      'hostApp', 'appVersion', 'userId', 'userName', 'officeNumber', 'companyId', 'officeId',
      'ehrEnabled', 'trainingMode', 'isPremier', 'appBasePath', 'kpiView', 'loginName',
      'practiceLocationId', 'currentRoute', 'currentPath']);
    const otherCtx = Object.entries(ctx).filter(([k]) => !pageKeys.has(k));
    if (otherCtx.length > 0) {
      sections.push('', '--- ADDITIONAL CONTEXT ---');
      for (const [k, v] of otherCtx) sections.push(`\u2022 ${k}: ${v}`);
    }

    // Chat transcript
    sections.push('', `--- CHAT TRANSCRIPT (${b.chatHistory.length} messages) ---`, transcript);

    // Attachments
    if (attachmentLines.length > 0) {
      sections.push('', '--- ATTACHMENTS (links expire in 15 min) ---', ...attachmentLines);
    }

    const description = sections.filter(s => s !== undefined).join('\n');

    // ── Create Salesforce Case ──────────────────────────────────

    // Use AI-generated subject if available, otherwise generic
    const caseSubject = aiSubject || `Chat Escalation: ${assistant.name}${b.reason ? ` - ${b.reason}` : ''}`;

    // Use higher of AI-suggested priority vs config default
    const priorityRank: Record<string, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };
    const configPriority = config.caseDefaults.priority || 'Medium';
    const effectivePriority = aiPriority && (priorityRank[aiPriority] ?? 0) > (priorityRank[configPriority] ?? 0)
      ? aiPriority : configPriority;

    // ── Build custom field mapping ────────────────────────────────

    const customFields: Record<string, unknown> = {};
    if (config.customFieldMapping?.enabled && config.customFieldMapping.fields.length > 0) {
      const allowed = new Set(config.customFieldMapping.fields);
      const fieldMap: Record<string, unknown> = {
        // Standard browser diagnostics
        Browser_Info__c: diag.userAgent ? `${diag.userAgent}` : undefined,
        User_Agent__c: diag.userAgent,
        Page_Url__c: ctx.getUrl || ctx.url,
        Screen_Resolution__c: diag.screenResolution,
        Session_Id__c: b.sessionId,
        Environment_Type__c: diag.platform,
        Operating_System__c: diag.platform,
        // Encompass / Eyefinity host app fields
        Host_App__c: diag.hostApp,
        Host_App_Version__c: diag.hostAppVersion,
        Encompass_User__c: diag.encompassUser,
        Encompass_User_Id__c: diag.encompassUserId,
        Office_Number__c: diag.officeNumber,
        Company_Id__c: diag.companyId,
        Office_Id__c: diag.officeId,
        EHR_Enabled__c: diag.ehrEnabled,
        Training_Mode__c: diag.trainingMode,
        Login_Name__c: diag.loginName,
        Practice_Location_Id__c: diag.practiceLocationId,
        Current_Route__c: diag.currentRoute || diag.currentPath,
      };
      for (const [field, value] of Object.entries(fieldMap)) {
        if (value !== undefined && allowed.has(field)) {
          customFields[field] = typeof value === 'string' ? value.substring(0, 255) : value;
        }
      }
    }

    const caseData: salesforce.ISalesforceCase = {
      Subject: caseSubject.substring(0, 255),
      Description: description.substring(0, 32000), // SF Description limit
      Priority: effectivePriority,
      Origin: config.caseDefaults.origin || 'Chat',
      Status: config.caseDefaults.status || 'New',
      ...(config.caseDefaults.recordTypeId ? { RecordTypeId: config.caseDefaults.recordTypeId } : {}),
      ...(b.userInfo?.name ? { SuppliedName: b.userInfo.name } : {}),
      ...(b.userInfo?.email ? { SuppliedEmail: b.userInfo.email } : {}),
      ...(b.userInfo?.phone ? { SuppliedPhone: b.userInfo.phone } : {}),
      ...customFields,
    };

    // Try creating the case; if custom fields cause picklist errors, strip them and retry
    let caseResult: { id: string; caseNumber?: string };
    try {
      caseResult = await salesforce.createCase(token.accessToken, token.instanceUrl, caseData);
    } catch (createErr) {
      const errMsg = String(createErr);
      if (errMsg.includes('INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST') || errMsg.includes('INVALID_FIELD')) {
        console.warn('Case creation failed with field error, retrying without custom fields:', errMsg);
        // Strip all custom __c fields and retry with standard fields only
        const standardData = Object.fromEntries(
          Object.entries(caseData).filter(([k]) => !k.endsWith('__c'))
        ) as salesforce.ISalesforceCase;
        caseResult = await salesforce.createCase(token.accessToken, token.instanceUrl, standardData);
      } else {
        throw createErr;
      }
    }

    // ── Attach transcript + diagnostics as files on the Case ────

    try {
      // Attach full transcript as .txt
      const transcriptBase64 = Buffer.from(description).toString('base64');
      await salesforce.addAttachment(token.accessToken, token.instanceUrl, {
        Name: `chat-transcript-${b.sessionId ?? 'unknown'}.txt`,
        Body: transcriptBase64,
        ContentType: 'text/plain',
        ParentId: caseResult.id,
      });

      // Attach diagnostics as .json
      if (Object.keys(diag).length > 0) {
        const diagJson = JSON.stringify({ ...diag, context: ctx, sessionId: b.sessionId }, null, 2);
        const diagBase64 = Buffer.from(diagJson).toString('base64');
        await salesforce.addAttachment(token.accessToken, token.instanceUrl, {
          Name: `diagnostics-${b.sessionId ?? 'unknown'}.json`,
          Body: diagBase64,
          ContentType: 'application/json',
          ParentId: caseResult.id,
        });
      }
    } catch (attachErr) {
      console.warn('Non-critical: failed to attach files to case', attachErr);
    }

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
/**
 * Public widget endpoint — add a follow-up comment to an existing Salesforce Case.
 * Authenticated via API key.
 */
export async function handleWidgetCaseComment(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const b = parseBody<{
      caseId: string;
      comment: string;
    }>(JSON.stringify(body));
    if (!b?.caseId || !b?.comment) return badRequest('caseId and comment are required');

    const assistant = await findAssistantByApiKey(apiKey) as {
      id: string; tenantId: string; name: string;
    } | null;
    if (!assistant) return unauthorized('Invalid API key');

    const config = await ddb.getItem<IEscalationConfig>(ESCALATION_TABLE, { assistantId: assistant.id });
    if (!config?.enabled) return badRequest('Escalation is not enabled');

    const token = await getSalesforceToken(config);
    const commentId = await salesforce.addCaseComment(
      token.accessToken, token.instanceUrl,
      b.caseId, b.comment, true,
    );

    return ok({ success: true, commentId });
  } catch (e) {
    console.error('widget case-comment error', e);
    return serverError(String(e));
  }
}

/**
 * Public widget endpoint — check status of an existing Salesforce Case.
 * Authenticated via API key.
 */
export async function handleWidgetCaseStatus(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const b = parseBody<{ caseId: string }>(JSON.stringify(body));
    if (!b?.caseId) return badRequest('caseId is required');

    const assistant = await findAssistantByApiKey(apiKey) as {
      id: string; tenantId: string; name: string;
    } | null;
    if (!assistant) return unauthorized('Invalid API key');

    const config = await ddb.getItem<IEscalationConfig>(ESCALATION_TABLE, { assistantId: assistant.id });
    if (!config?.enabled) return badRequest('Escalation is not enabled');

    const token = await getSalesforceToken(config);
    const status = await salesforce.getCaseStatus(
      token.accessToken, token.instanceUrl, b.caseId,
    );

    return ok({ success: true, ...status });
  } catch (e) {
    console.error('widget case-status error', e);
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
