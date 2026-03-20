/**
 * Escalation Agent — Bedrock action group handler for support case management.
 *
 * Tools:
 *   - summarizeConversation: AI-generated summary of the chat for handoff
 *   - createSupportCase: Create a Salesforce case with conversation context
 *   - getCaseStatus: Check status of an existing case
 *   - addCaseComment: Add a follow-up comment to a case
 *   - checkLiveAgentAvailability: Check if Amelia/live agent is online (placeholder)
 *   - transferToLiveAgent: Warm handoff to Amelia with conversation summary (placeholder)
 */

import * as salesforce from './salesforce';
import * as ddb from './dynamo';
import { invokeModel } from './bedrock-chat';

const ESCALATION_TABLE = process.env['ESCALATION_CONFIG_TABLE'] ?? '';
const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';

interface IEscalationConfig {
  assistantId: string;
  tenantId: string;
  enabled: boolean;
  authMode: 'jwt' | 'password';
  salesforceInstanceUrl: string;
  salesforceConsumerKey: string;
  salesforceUsername: string;
  ssmPrivateKeyParam: string;
  salesforceLoginUrl?: string;
  salesforceClientId?: string;
  ssmPasswordCredentialsParam?: string;
  caseDefaults: {
    priority: string;
    origin: string;
    status: string;
    recordTypeId?: string;
  };
}

/**
 * Handle Bedrock action group invocations for the escalation agent.
 */
export async function handleEscalationAction(event: any): Promise<any> {
  const apiPath = event.apiPath ?? '';
  const params = extractParams(event);
  const tenantId = event.sessionAttributes?.tenantId ?? '';

  console.log(`[EscalationAgent] ${apiPath}`, JSON.stringify(params).slice(0, 200));

  try {
    switch (apiPath) {
      case '/summarizeConversation':
        return formatResponse(event, await summarizeConversation(params.transcript));

      case '/createSupportCase':
        return formatResponse(event, await createSupportCase(tenantId, params));

      case '/getCaseStatus':
        return formatResponse(event, await getCaseStatus(tenantId, params.caseId));

      case '/addCaseComment':
        return formatResponse(event, await addCaseComment(tenantId, params.caseId, params.comment));

      case '/checkLiveAgentAvailability':
        return formatResponse(event, await checkLiveAgentAvailability(tenantId));

      case '/transferToLiveAgent':
        return formatResponse(event, await transferToLiveAgent(tenantId, params));

      default:
        return formatResponse(event, { error: `Unknown action: ${apiPath}` });
    }
  } catch (err) {
    console.error(`[EscalationAgent] ${apiPath} error:`, err);
    return formatResponse(event, { error: String(err) });
  }
}

// ── Tool Implementations ──────────────────────────────────────────────────────

async function summarizeConversation(transcript: string): Promise<any> {
  const summary = await invokeModel(
    `You are a support case summarizer. Given a chat transcript between a user and an AI assistant, produce a concise summary for a human support agent. Include:
1. What the user was trying to do
2. What went wrong or why they need help
3. Key details mentioned (patient names, dates, error messages)
4. The user's sentiment (calm, frustrated, urgent)
Keep it under 200 words.`,
    `Chat transcript:\n${transcript}`,
  );

  return { summary };
}

async function createSupportCase(
  tenantId: string,
  params: Record<string, string>,
): Promise<any> {
  const config = await getEscalationConfig(tenantId);
  if (!config) return { error: 'Escalation not configured for this tenant' };

  const { accessToken, instanceUrl } = await getSalesforceToken(config);

  const caseData: salesforce.ISalesforceCase = {
    Subject: params.subject || 'AI Chat Escalation',
    Description: params.description || params.summary || 'Escalated from AI chat',
    Priority: params.priority || config.caseDefaults?.priority || 'Medium',
    Origin: config.caseDefaults?.origin || 'Chat',
    Status: config.caseDefaults?.status || 'New',
    ...(config.caseDefaults?.recordTypeId && { RecordTypeId: config.caseDefaults.recordTypeId }),
  };

  const result = await salesforce.createCase(accessToken, instanceUrl, caseData);

  return {
    success: true,
    caseId: result.id,
    caseNumber: result.caseNumber,
    message: `Support case ${result.caseNumber ?? result.id} has been created. A team member will review it shortly.`,
  };
}

async function getCaseStatus(tenantId: string, caseId: string): Promise<any> {
  const config = await getEscalationConfig(tenantId);
  if (!config) return { error: 'Escalation not configured' };

  const { accessToken, instanceUrl } = await getSalesforceToken(config);
  const status = await salesforce.getCaseStatus(accessToken, instanceUrl, caseId);

  return {
    caseId,
    status: status.status,
    priority: status.priority,
    subject: status.subject,
    lastUpdated: status.lastModifiedDate,
    recentComments: status.comments.slice(0, 3).map(c => ({
      comment: c.body,
      date: c.createdDate,
    })),
  };
}

async function addCaseComment(tenantId: string, caseId: string, comment: string): Promise<any> {
  const config = await getEscalationConfig(tenantId);
  if (!config) return { error: 'Escalation not configured' };

  const { accessToken, instanceUrl } = await getSalesforceToken(config);
  const commentId = await salesforce.addCaseComment(accessToken, instanceUrl, caseId, comment);

  return { success: true, commentId, message: 'Comment added to the case.' };
}

async function checkLiveAgentAvailability(tenantId: string): Promise<any> {
  // Placeholder — will be replaced with Amelia API check
  // For now, simulate based on business hours (8am-6pm ET)
  const now = new Date();
  const etHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
  const isBusinessHours = etHour >= 8 && etHour < 18;
  const dayOfWeek = now.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  return {
    available: isBusinessHours && isWeekday,
    provider: 'Amelia',
    status: isBusinessHours && isWeekday ? 'online' : 'offline',
    estimatedWaitMinutes: isBusinessHours && isWeekday ? 2 : null,
    nextAvailable: !isBusinessHours || !isWeekday
      ? 'Next business day, 8:00 AM ET'
      : null,
    message: isBusinessHours && isWeekday
      ? 'A live agent is available. I can transfer you now.'
      : 'Live agents are currently offline. I can create a support case for follow-up.',
  };
}

async function transferToLiveAgent(tenantId: string, params: Record<string, string>): Promise<any> {
  // Placeholder — will integrate with Amelia's transfer API
  // For now, return a transfer URL or session info

  const availability = await checkLiveAgentAvailability(tenantId);
  if (!availability.available) {
    return {
      transferred: false,
      reason: 'Live agents are currently offline.',
      alternative: 'I can create a support case instead. Would you like me to do that?',
    };
  }

  return {
    transferred: true,
    provider: 'Amelia',
    message: 'Connecting you with a live agent now. I\'ve shared a summary of our conversation so you won\'t need to repeat anything.',
    conversationSummary: params.summary ?? 'No summary available',
    // TODO: Replace with actual Amelia transfer API call
    // transferUrl: `https://amelia.example.com/chat?session=${sessionId}&context=${encodedSummary}`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getEscalationConfig(tenantId: string): Promise<IEscalationConfig | null> {
  // Find ANY assistant for this tenant that has escalation configured
  const assistants = await ddb.queryItems<any>(
    ASSISTANTS_TABLE, 'tenantId = :t', { ':t': tenantId }, undefined, 'tenantId-index',
  );
  if (!assistants.length) return null;

  // Check each assistant for escalation config
  for (const assistant of assistants) {
    const config = await ddb.getItem<IEscalationConfig>(
      ESCALATION_TABLE, { assistantId: assistant.id },
    );
    if (config && config.enabled) return config;
  }

  // Fallback: return first config even if not enabled
  for (const assistant of assistants) {
    const config = await ddb.getItem<IEscalationConfig>(
      ESCALATION_TABLE, { assistantId: assistant.id },
    );
    if (config) return config;
  }

  return null;
}

async function getSalesforceToken(config: IEscalationConfig) {
  if (config.authMode === 'password' && config.salesforceClientId && config.ssmPasswordCredentialsParam) {
    return salesforce.getAccessTokenPasswordFlow(
      { loginUrl: config.salesforceLoginUrl ?? 'https://login.salesforce.com', clientId: config.salesforceClientId, ssmCredentialsParam: config.ssmPasswordCredentialsParam },
      config.salesforceUsername,
    );
  }
  return salesforce.getAccessToken({
    instanceUrl: config.salesforceInstanceUrl,
    consumerKey: config.salesforceConsumerKey,
    username: config.salesforceUsername,
    ssmPrivateKeyParam: config.ssmPrivateKeyParam,
  });
}

function extractParams(event: any): Record<string, string> {
  const params: Record<string, string> = {};
  if (event.parameters) {
    for (const p of event.parameters) {
      params[p.name] = p.value;
    }
  }
  if (event.requestBody?.content?.['application/json']?.properties) {
    for (const p of event.requestBody.content['application/json'].properties) {
      params[p.name] = p.value;
    }
  }
  return params;
}

function formatResponse(event: any, body: unknown): any {
  return {
    messageVersion: '1.0',
    response: {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod ?? 'POST',
      httpStatusCode: 200,
      responseBody: {
        'application/json': { body: JSON.stringify(body) },
      },
    },
  };
}
