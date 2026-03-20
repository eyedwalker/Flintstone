/**
 * Agent Registry — manages specialist agents available for orchestrator routing.
 *
 * Reads from DynamoDB (admin-managed via UI) with hardcoded fallback defaults.
 * Each agent has routing keywords for fast-path dispatch and a description
 * for the Haiku classifier fallback.
 */

import * as ddb from './dynamo';

const AGENT_REGISTRY_TABLE = process.env['AGENT_REGISTRY_TABLE'] ?? 'chat-agent-registry-dev';

export type AgentType = 'bedrock-agent' | 'claude-direct';

export interface IAgentDefinition {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: AgentType;
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
  capabilities: string[];
  routingKeywords: string[];
  enabled: boolean;
  priority: number;
  createdAt?: string;
  updatedAt?: string;
}

// ── Hardcoded defaults (used when DynamoDB is empty) ──────────────────────────

const DEFAULT_REGISTRY: Omit<IAgentDefinition, 'tenantId'>[] = [
  {
    id: 'analytics',
    name: 'Encompass Larry',
    description:
      'Analytics and knowledge base agent. Handles Snowflake data queries, charts, reports, ' +
      'and VSP knowledge base lookups about Encompass practice management.',
    type: 'bedrock-agent',
    bedrockAgentId: 'KBAQR27COL',
    bedrockAgentAliasId: 'TSTALIASID',
    capabilities: ['snowflake-analytics', 'knowledge-base', 'reports', 'charts'],
    routingKeywords: [
      'report', 'chart', 'graph', 'query', 'data', 'analytics', 'revenue',
      'patients', 'billing', 'invoice', 'claims', 'trend', 'metric',
      'how do i', 'how to', 'what is', 'knowledge base', 'help with',
      'encompass', 'vsp', 'eligibility', 'authorization',
    ],
    enabled: true,
    priority: 1,
  },
  {
    id: 'front-office',
    name: 'Front Office Assistant',
    description:
      'Front office operations agent. Handles appointment scheduling, patient lookup, ' +
      'SMS, email, and voice calls.',
    type: 'bedrock-agent',
    bedrockAgentId: 'IYVTI2D2VJ',
    bedrockAgentAliasId: 'TSTALIASID',
    capabilities: ['appointments', 'sms', 'email', 'patient-lookup', 'voice'],
    routingKeywords: [
      'appointment', 'schedule', 'book', 'cancel', 'reschedule',
      'sms', 'text message', 'email', 'send', 'contact',
      'patient lookup', 'find patient', 'slot', 'available',
      'reminder', 'confirm', 'provider', 'doctor', 'office',
    ],
    enabled: true,
    priority: 2,
  },
  {
    id: 'escalation',
    name: 'Support Escalation',
    description:
      'Support escalation agent. Handles frustrated users, creates Salesforce cases, ' +
      'checks case status, transfers to live agents (Amelia), and follows up on open cases.',
    type: 'bedrock-agent',
    bedrockAgentId: 'WIE61RPMPV',
    bedrockAgentAliasId: 'TSTALIASID',
    capabilities: ['salesforce-cases', 'live-agent-transfer', 'conversation-summary'],
    routingKeywords: [
      'talk to someone', 'speak to a person', 'human', 'agent', 'help me',
      'frustrated', 'not working', 'broken', 'escalate', 'manager',
      'supervisor', 'complaint', 'support case', 'ticket', 'case status',
      'follow up', 'live agent', 'transfer me', 'real person',
    ],
    enabled: true,
    priority: 3,
  },
];

// ── Registry Operations ───────────────────────────────────────────────────────

/** Get all agents for a tenant (from DynamoDB, falls back to defaults) */
export async function getAllAgents(tenantId?: string): Promise<IAgentDefinition[]> {
  if (!tenantId) {
    return DEFAULT_REGISTRY.map(a => ({ ...a, tenantId: '' }));
  }

  try {
    const items = await ddb.queryItems<IAgentDefinition>(
      AGENT_REGISTRY_TABLE,
      'tenantId = :t',
      { ':t': tenantId },
      undefined,
      'tenantId-index',
    );

    if (items.length > 0) return items;
  } catch {
    // Table may not exist yet — fall through to defaults
  }

  return DEFAULT_REGISTRY.map(a => ({ ...a, tenantId }));
}

/** Get enabled agents sorted by priority */
export async function getEnabledAgents(tenantId?: string): Promise<IAgentDefinition[]> {
  const all = await getAllAgents(tenantId);
  return all.filter(a => a.enabled).sort((a, b) => a.priority - b.priority);
}

/** Get a specific agent by ID */
export async function getAgent(id: string, tenantId?: string): Promise<IAgentDefinition | undefined> {
  // Try DynamoDB first
  try {
    const item = await ddb.getItem<IAgentDefinition>(AGENT_REGISTRY_TABLE, { id });
    if (item) return item;
  } catch { /* fall through */ }

  // Fall back to defaults
  const def = DEFAULT_REGISTRY.find(a => a.id === id);
  return def ? { ...def, tenantId: tenantId ?? '' } : undefined;
}

/** Get the default/fallback agent */
export async function getDefaultAgent(tenantId?: string): Promise<IAgentDefinition> {
  const enabled = await getEnabledAgents(tenantId);
  if (enabled.length === 0) {
    throw new Error('No agents are enabled in the registry');
  }
  return enabled[0];
}

/** Register or update an agent */
export async function upsertAgent(agent: IAgentDefinition): Promise<IAgentDefinition> {
  const now = new Date().toISOString();
  const record = {
    ...agent,
    updatedAt: now,
    createdAt: agent.createdAt ?? now,
  };
  await ddb.putItem(AGENT_REGISTRY_TABLE, record as unknown as Record<string, unknown>);
  return record;
}

/** Delete an agent from the registry */
export async function deleteAgentFromRegistry(id: string): Promise<void> {
  await ddb.deleteItem(AGENT_REGISTRY_TABLE, { id });
}

/** Seed the registry with defaults for a tenant (if empty) */
export async function seedDefaults(tenantId: string): Promise<number> {
  const existing = await getAllAgents(tenantId);
  // If we got non-default entries, don't seed
  if (existing.some(a => a.createdAt)) return 0;

  let count = 0;
  for (const def of DEFAULT_REGISTRY) {
    await upsertAgent({ ...def, tenantId });
    count++;
  }
  return count;
}
