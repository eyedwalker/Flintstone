/**
 * Orchestrator — routes chat messages to the correct specialist agent.
 *
 * Flow:
 *  1. Security agent scans the message (PII redaction, injection blocking)
 *  2. Session affinity check (stay with same agent within a session)
 *  3. Fast-path keyword matching
 *  4. Fallback to default agent (Encompass Larry)
 *
 * Feature-flagged via tenant/node `useOrchestrator` setting.
 * When disabled, the old direct-to-Larry code path is used unchanged.
 */

import * as securityAgent from './security-agent';
import * as registry from './agent-registry';
import { IAgentDefinition } from './agent-registry';

// ── Session affinity cache (in-memory, per Lambda instance) ───────────────────
// Maps sessionId → agentId to keep conversations on the same agent.
// TTL: entries expire after 60 minutes of inactivity.

interface ISessionEntry {
  agentId: string;
  lastUsed: number;
}

const sessionAffinityCache = new Map<string, ISessionEntry>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 60 minutes

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [key, entry] of sessionAffinityCache) {
    if (now - entry.lastUsed > SESSION_TTL_MS) {
      sessionAffinityCache.delete(key);
    }
  }
}

// Clean up every 10 minutes
setInterval(cleanExpiredSessions, 10 * 60 * 1000).unref();

// ── Dispatch Result ───────────────────────────────────────────────────────────

export interface IDispatchResult {
  /** The agent selected to handle this message */
  agent: IAgentDefinition;
  /** The message to send to the agent (original, not redacted) */
  message: string;
  /** The log-safe version of the message (PII redacted) */
  sanitizedForLog: string;
  /** Security flags raised during scan */
  securityFlags: securityAgent.IScanFlag[];
}

export interface IDispatchError {
  blocked: true;
  reason: string;
  securityFlags: securityAgent.IScanFlag[];
}

// ── Main Dispatch Function ────────────────────────────────────────────────────

/**
 * Route a message to the appropriate specialist agent.
 *
 * @param message - The user's raw message
 * @param sessionId - Chat session ID (for session affinity)
 * @param tenantId - Tenant/organization ID (for audit logging)
 * @param userId - User ID (for audit logging)
 * @param enabledAgentIds - Optional list of agent IDs enabled for this node/tenant.
 *                          If not provided, all enabled agents are considered.
 */
export async function dispatch(
  message: string,
  sessionId: string,
  tenantId: string,
  userId?: string,
  enabledAgentIds?: string[],
): Promise<IDispatchResult | IDispatchError> {
  // ── 1. Security scan ───────────────────────────────────────────────────────
  const scan = securityAgent.scan(message);

  // Log security events if any flags were raised
  if (scan.flags.length > 0) {
    await securityAgent.logSecurityEvent(
      tenantId,
      userId ?? 'anonymous',
      scan.flags,
      scan.sanitizedForLog,
    );
  }

  if (!scan.allowed) {
    return {
      blocked: true,
      reason: scan.reason ?? 'Message blocked by security scan.',
      securityFlags: scan.flags,
    };
  }

  // ── 2. Resolve available agents ────────────────────────────────────────────
  let agents = await registry.getEnabledAgents(tenantId);

  // Filter by node-level enabled agent IDs if provided
  if (enabledAgentIds && enabledAgentIds.length > 0) {
    agents = agents.filter((a) => enabledAgentIds.includes(a.id));
  }

  // Fallback: if no agents match the filter, use all enabled agents
  if (agents.length === 0) {
    agents = await registry.getEnabledAgents(tenantId);
  }

  // ── 3. Session affinity — stay with same agent within a session ────────────
  const cached = sessionAffinityCache.get(sessionId);
  if (cached) {
    const cachedAgent = agents.find((a) => a.id === cached.agentId);
    if (cachedAgent) {
      cached.lastUsed = Date.now();
      return {
        agent: cachedAgent,
        message: scan.message,
        sanitizedForLog: scan.sanitizedForLog,
        securityFlags: scan.flags,
      };
    }
  }

  // ── 4. Fast-path keyword matching ──────────────────────────────────────────
  const selectedAgent = matchByKeywords(message, agents) ?? agents[0];

  // Store session affinity
  sessionAffinityCache.set(sessionId, {
    agentId: selectedAgent.id,
    lastUsed: Date.now(),
  });

  return {
    agent: selectedAgent,
    message: scan.message,
    sanitizedForLog: scan.sanitizedForLog,
    securityFlags: scan.flags,
  };
}

// ── Keyword Matching ──────────────────────────────────────────────────────────

/**
 * Score each agent by how many of its routing keywords appear in the message.
 * Returns the agent with the highest score, or undefined if no keywords match.
 */
function matchByKeywords(
  message: string,
  agents: IAgentDefinition[],
): IAgentDefinition | undefined {
  const lower = message.toLowerCase();
  let bestAgent: IAgentDefinition | undefined;
  let bestScore = 0;

  for (const agent of agents) {
    let score = 0;
    const matched: string[] = [];
    for (const keyword of agent.routingKeywords) {
      if (lower.includes(keyword.toLowerCase())) {
        score++;
        matched.push(keyword);
      }
    }
    console.log(`[Orchestrator] ${agent.name}: score=${score} priority=${agent.priority} matched=[${matched.join(', ')}]`);
    // Higher score wins. On tie, lower priority number wins (escalation=1 beats larry=3)
    if (score > bestScore || (score === bestScore && score > 0 && agent.priority < (bestAgent?.priority ?? 999))) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  if (bestAgent) {
    console.log(`[Orchestrator] Winner: ${bestAgent.name} (score=${bestScore})`);
  }
  return bestAgent;
}

/**
 * Check if a dispatch result is a blocked error.
 */
export function isBlocked(result: IDispatchResult | IDispatchError): result is IDispatchError {
  return 'blocked' in result && result.blocked === true;
}
