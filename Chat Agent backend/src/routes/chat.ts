import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import * as bedrockChat from '../services/bedrock-chat';
import * as orchestrator from '../services/orchestrator';
import { ok, badRequest, forbidden, notFound, serverError } from '../response';
import { assertOwnership, parseBody, resolveNodeRole } from '../auth';

const TABLE = process.env['ASSISTANTS_TABLE'] ?? '';
const TENANTS_TABLE = process.env['TENANTS_TABLE'] ?? '';
const NODE_USERS_TABLE = process.env['NODE_USERS_TABLE'] ?? '';
const METRICS_TABLE = process.env['METRICS_TABLE'] ?? '';

/** Classify conversation intent from Bedrock action group calls */
export function classifyIntent(actionGroupCalls?: Array<{ actionGroupName?: string; apiPath?: string }>): string {
  if (!actionGroupCalls || actionGroupCalls.length === 0) return 'help'; // KB-only = help

  const paths = actionGroupCalls.map(c => (c.apiPath ?? c.actionGroupName ?? '').toLowerCase());

  const hasReporting = paths.some(p =>
    p.includes('snowflake') || p.includes('query') || p.includes('chart') ||
    p.includes('report') || p.includes('analytics') || p.includes('sql') ||
    p.includes('describe_table') || p.includes('generate_chart') || p.includes('generate_report') ||
    p.includes('multi_report')
  );

  const hasFrontOffice = paths.some(p =>
    p.includes('appointment') || p.includes('patient') || p.includes('office') ||
    p.includes('provider') || p.includes('staff') || p.includes('slot') ||
    p.includes('sms') || p.includes('email') || p.includes('call') ||
    p.includes('book') || p.includes('search')
  );

  if (hasReporting && hasFrontOffice) return 'mixed';
  if (hasReporting) return 'reporting';
  if (hasFrontOffice) return 'front-office';
  return 'help';
}

interface IAssistantChatInfo {
  id: string;
  tenantId: string;
  status: string;
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
  bedrockKnowledgeBaseId?: string;
  systemPrompt?: string;
  modelConfig?: { systemPrompt?: string };
}

interface INodeUser {
  userId: string;
  nodeId?: string;
  role: string;
}

/**
 * POST /assistants/:id/chat
 * Body:
 *   { message, sessionId?, userId?, nodeId?, testRoleLevel? }
 *
 * Role resolution order:
 *  1. testRoleLevel — set by authenticated admin for in-app testing (trusted via JWT)
 *  2. userId + nodeId — looked up in node-users table (production widget calls)
 *  3. No role info — no KB filter applied (unrestricted, for anonymous/legacy clients)
 */
export async function handleChat(
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  tenantId: string,
): Promise<APIGatewayProxyResultV2> {
  try {
    const assistantId = params['id'];
    if (!assistantId) return badRequest('Missing assistant id');

    const assistant = await ddb.getItem<IAssistantChatInfo>(TABLE, { id: assistantId });
    if (!assistant) return notFound('Assistant not found');
    if (!assertOwnership(assistant.tenantId, tenantId)) return forbidden();

    if (assistant.status !== 'ready') {
      return badRequest(`Assistant is not ready (status: ${assistant.status}). Provision it first.`);
    }
    if (!assistant.bedrockAgentId || !assistant.bedrockAgentAliasId) {
      return badRequest('Assistant has no Bedrock agent. Provision it first.');
    }

    const b = parseBody<{
      message: string;
      sessionId?: string;
      userId?: string;
      nodeId?: string;
      testRoleLevel?: number;
    }>(JSON.stringify(body));
    if (!b?.message?.trim()) return badRequest('message is required');

    // ── Determine effective role level ──────────────────────────────────────
    let roleLevel: number | undefined;

    if (typeof b.testRoleLevel === 'number') {
      // Authenticated admin testing from in-app panel — trust the supplied level
      roleLevel = Math.max(0, Math.min(99, b.testRoleLevel));
    } else if (b.userId) {
      // Production widget call — look up role from node-users
      const nodeUser = await ddb.getItem<INodeUser>(NODE_USERS_TABLE, { userId: b.userId });
      if (nodeUser) {
        roleLevel = resolveNodeRole(nodeUser.role);
      } else {
        roleLevel = 0; // unknown user → public access only
      }
    }
    // If neither: no filter applied (all content visible)

    // ── Build role filter for Bedrock KB retrieval ──────────────────────────
    const roleFilter = (roleLevel !== undefined && assistant.bedrockKnowledgeBaseId)
      ? { knowledgeBaseId: assistant.bedrockKnowledgeBaseId, roleLevel }
      : undefined;

    const sessionId = b.sessionId ?? uuidv4();
    const messageText = b.message.trim();

    // ── Feature flag: orchestrator ───────────────────────────────────────────
    // When enabled, messages go through security scan + agent routing.
    // When disabled (default), direct-to-assistant code path — zero change.
    let useOrchestrator = false;
    try {
      if (TENANTS_TABLE) {
        const tenant = await ddb.getItem<{ useOrchestrator?: boolean }>(
          TENANTS_TABLE, { id: tenantId },
        );
        useOrchestrator = !!tenant?.useOrchestrator;
      }
    } catch { /* non-critical — default to false */ }

    let agentId = assistant.bedrockAgentId;
    let agentAliasId = assistant.bedrockAgentAliasId;
    let routedAgentName: string | undefined;
    let sanitizedForLog = messageText;
    let securityFlags: unknown[] = [];

    if (useOrchestrator) {
      const result = await orchestrator.dispatch(messageText, sessionId, tenantId);
      if (orchestrator.isBlocked(result)) {
        return badRequest(result.reason);
      }
      // Use the routed agent's Bedrock IDs if available, otherwise fall back to assistant's
      if (result.agent.bedrockAgentId) agentId = result.agent.bedrockAgentId;
      if (result.agent.bedrockAgentAliasId) agentAliasId = result.agent.bedrockAgentAliasId;
      routedAgentName = result.agent.name;
      sanitizedForLog = result.sanitizedForLog;
      securityFlags = result.securityFlags;
    }

    const startMs = Date.now();
    const agentResult = await bedrockChat.invokeAgent(
      agentId,
      agentAliasId,
      messageText,
      sessionId,
      roleFilter,
    );
    const latencyMs = Date.now() - startMs;

    const reply = agentResult.text;

    // Classify intent from action group calls
    const intent = classifyIntent(agentResult.actionGroupCalls);

    // Write metrics record (fire-and-forget)
    let metricId: string | undefined;
    try {
      metricId = uuidv4();
      await ddb.putItem(METRICS_TABLE, {
        id: metricId,
        assistantId,
        tenantId,
        sessionId,
        query: sanitizedForLog, // PII-redacted version for logs
        responseLength: reply.length,
        latencyMs,
        intent,
        guardrailTriggered: false,
        videoCited: /video|vimeo|youtube/i.test(reply),
        satisfied: null,
        source: 'admin',
        ...(routedAgentName && { routedAgent: routedAgentName }),
        ...(securityFlags.length > 0 && { securityFlags }),
        createdAt: new Date().toISOString(),
      });
    } catch (metricErr) {
      console.error('metrics write error (non-critical)', metricErr);
    }

    return ok({
      reply,
      sessionId,
      metricId,
      ...(routedAgentName && { agentName: routedAgentName }),
      ...(agentResult.actionGroupCalls && { actionGroupCalls: agentResult.actionGroupCalls }),
    });
  } catch (e) {
    console.error('chat handler error', e);
    return serverError(String(e));  // serverError now sanitizes — only logs internally
  }
}
