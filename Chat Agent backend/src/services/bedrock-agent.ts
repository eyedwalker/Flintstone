import {
  BedrockAgentClient,
  CreateAgentCommand,
  UpdateAgentCommand,
  DeleteAgentCommand,
  PrepareAgentCommand,
  GetAgentCommand,
  CreateAgentAliasCommand,
  UpdateAgentAliasCommand,
  AssociateAgentKnowledgeBaseCommand,
  DisassociateAgentKnowledgeBaseCommand,
  ListAgentsCommand,
  ListAgentActionGroupsCommand,
  GetAgentActionGroupCommand,
  CreateAgentActionGroupCommand,
  UpdateAgentActionGroupCommand,
  DeleteAgentActionGroupCommand,
  ListAgentKnowledgeBasesCommand,
  ListAgentAliasesCommand,
} from '@aws-sdk/client-bedrock-agent';

const client = new BedrockAgentClient({ region: process.env['REGION'] ?? 'us-west-2' });

interface ModelConfig {
  modelId: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export async function createAgent(
  name: string,
  modelConfig: ModelConfig,
  agentRoleArn: string
): Promise<{ agentId: string; agentStatus: string }> {
  const instruction = (modelConfig.systemPrompt || '').trim()
    || `You are a helpful AI assistant for ${name}.`;

  // Do NOT pass promptOverrideConfiguration when using the default prompt template.
  // Bedrock rejects inferenceConfiguration and promptState with promptCreationMode DEFAULT.
  // The instruction field is the correct way to set the agent's behaviour with default templates.
  try {
    const res = await client.send(new CreateAgentCommand({
      agentName: name,
      foundationModel: modelConfig.modelId,
      instruction,
      agentResourceRoleArn: agentRoleArn,
      idleSessionTTLInSeconds: 600,
    }));
    return {
      agentId: res.agent?.agentId ?? '',
      agentStatus: res.agent?.agentStatus ?? '',
    };
  } catch (e: any) {
    // If an agent with this name already exists, find and reuse it
    if (e?.name === 'ConflictException' || e?.message?.includes('already exists')) {
      let nextToken: string | undefined;
      do {
        const list = await client.send(new ListAgentsCommand({ nextToken }));
        const match = list.agentSummaries?.find(a => a.agentName === name);
        if (match) {
          return { agentId: match.agentId ?? '', agentStatus: match.agentStatus ?? '' };
        }
        nextToken = list.nextToken;
      } while (nextToken);
      throw new Error(`Agent named '${name}' already exists but could not be found in list`);
    }
    throw e;
  }
}

export async function updateAgent(
  agentId: string,
  name: string,
  modelConfig: ModelConfig,
  agentRoleArn: string
): Promise<void> {
  const instruction = (modelConfig.systemPrompt || '').trim()
    || `You are a helpful AI assistant for ${name}.`;

  await client.send(new UpdateAgentCommand({
    agentId,
    agentName: name,
    foundationModel: modelConfig.modelId,
    instruction,
    agentResourceRoleArn: agentRoleArn,
    idleSessionTTLInSeconds: 600,
  }));
}

export async function deleteAgent(agentId: string): Promise<void> {
  await client.send(new DeleteAgentCommand({ agentId, skipResourceInUseCheck: false }));
}

/** Wait until an agent exits CREATING/UPDATING state before operating on it */
async function waitForAgentStable(agentId: string, timeoutMs = 60_000): Promise<void> {
  const transientStates = new Set(['CREATING', 'UPDATING', 'PREPARING', 'VERSIONING']);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.send(new GetAgentCommand({ agentId }));
    const status = res.agent?.agentStatus ?? '';
    if (!transientStates.has(status)) return;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`Agent ${agentId} did not reach a stable state within ${timeoutMs}ms`);
}

/** Prepares the DRAFT version of the agent (waits for stable state before and after). */
export async function prepareAgent(agentId: string): Promise<void> {
  await waitForAgentStable(agentId);
  await client.send(new PrepareAgentCommand({ agentId }));
  await waitForAgentStable(agentId);
}

export async function createAlias(
  agentId: string,
  aliasName: string,
  agentVersion: string
): Promise<{ agentAliasId: string }> {
  const res = await client.send(new CreateAgentAliasCommand({
    agentId,
    agentAliasName: aliasName,
    routingConfiguration: [{ agentVersion }],
  }));
  return { agentAliasId: res.agentAlias?.agentAliasId ?? '' };
}

export async function updateAlias(
  agentId: string,
  agentAliasId: string,
  agentVersion: string
): Promise<void> {
  await client.send(new UpdateAgentAliasCommand({
    agentId,
    agentAliasId,
    agentAliasName: 'production',
    routingConfiguration: [{ agentVersion }],
  }));
}

export async function associateKnowledgeBase(
  agentId: string,
  agentVersion: string,
  knowledgeBaseId: string,
  description: string
): Promise<void> {
  await client.send(new AssociateAgentKnowledgeBaseCommand({
    agentId,
    agentVersion,
    knowledgeBaseId,
    description,
    knowledgeBaseState: 'ENABLED',
  }));
}

export async function disassociateKnowledgeBase(
  agentId: string,
  agentVersion: string,
  knowledgeBaseId: string
): Promise<void> {
  await client.send(new DisassociateAgentKnowledgeBaseCommand({
    agentId, agentVersion, knowledgeBaseId,
  }));
}

// ── Live Agent Inspection ─────────────────────────────────────────────────────

/** Get full agent details from Bedrock (live, not cached) */
export async function getAgentDetails(agentId: string): Promise<{
  agentId: string;
  agentName: string;
  foundationModel: string;
  instruction: string;
  agentStatus: string;
  idleSessionTTLInSeconds: number;
  failureReasons?: string[];
  createdAt?: string;
  updatedAt?: string;
}> {
  const res = await client.send(new GetAgentCommand({ agentId }));
  const a = res.agent!;
  return {
    agentId: a.agentId ?? '',
    agentName: a.agentName ?? '',
    foundationModel: a.foundationModel ?? '',
    instruction: a.instruction ?? '',
    agentStatus: a.agentStatus ?? '',
    idleSessionTTLInSeconds: a.idleSessionTTLInSeconds ?? 600,
    failureReasons: a.failureReasons,
    createdAt: a.createdAt?.toISOString(),
    updatedAt: a.updatedAt?.toISOString(),
  };
}

/** List all agents in the account */
export async function listAllAgents(): Promise<Array<{
  agentId: string;
  agentName: string;
  agentStatus: string;
  foundationModel?: string;
  updatedAt?: string;
}>> {
  const agents: any[] = [];
  let nextToken: string | undefined;
  do {
    const res = await client.send(new ListAgentsCommand({ nextToken }));
    for (const a of res.agentSummaries ?? []) {
      agents.push({
        agentId: a.agentId,
        agentName: a.agentName,
        agentStatus: a.agentStatus,
        updatedAt: a.updatedAt?.toISOString(),
      });
    }
    nextToken = res.nextToken;
  } while (nextToken);
  return agents;
}

// ── Action Group Management ───────────────────────────────────────────────────

/** List action groups for an agent */
export async function listActionGroups(agentId: string): Promise<Array<{
  actionGroupId: string;
  actionGroupName: string;
  actionGroupState: string;
  updatedAt?: string;
}>> {
  const res = await client.send(new ListAgentActionGroupsCommand({
    agentId,
    agentVersion: 'DRAFT',
  }));
  return (res.actionGroupSummaries ?? []).map(ag => ({
    actionGroupId: ag.actionGroupId ?? '',
    actionGroupName: ag.actionGroupName ?? '',
    actionGroupState: ag.actionGroupState ?? '',
    updatedAt: ag.updatedAt?.toISOString(),
  }));
}

/** Get action group details including API schema */
export async function getActionGroupDetails(agentId: string, actionGroupId: string): Promise<{
  actionGroupId: string;
  actionGroupName: string;
  actionGroupState: string;
  description?: string;
  apiSchema?: string;
  lambdaArn?: string;
}> {
  const res = await client.send(new GetAgentActionGroupCommand({
    agentId,
    agentVersion: 'DRAFT',
    actionGroupId,
  }));
  const ag = res.agentActionGroup!;
  return {
    actionGroupId: ag.actionGroupId ?? '',
    actionGroupName: ag.actionGroupName ?? '',
    actionGroupState: ag.actionGroupState ?? '',
    description: ag.description,
    apiSchema: (ag.apiSchema as any)?.payload,
    lambdaArn: (ag.actionGroupExecutor as any)?.lambda,
  };
}

/** Create a new action group on an agent */
export async function createActionGroup(
  agentId: string,
  name: string,
  lambdaArn: string,
  apiSchemaJson: string,
  description?: string,
): Promise<{ actionGroupId: string }> {
  const res = await client.send(new CreateAgentActionGroupCommand({
    agentId,
    agentVersion: 'DRAFT',
    actionGroupName: name,
    actionGroupExecutor: { lambda: lambdaArn },
    apiSchema: { payload: apiSchemaJson },
    ...(description && { description }),
  }));
  return { actionGroupId: res.agentActionGroup?.actionGroupId ?? '' };
}

/** Update an existing action group */
export async function updateActionGroup(
  agentId: string,
  actionGroupId: string,
  updates: {
    name?: string;
    apiSchemaJson?: string;
    lambdaArn?: string;
    state?: 'ENABLED' | 'DISABLED';
    description?: string;
  },
): Promise<void> {
  // Get current to merge
  const current = await getActionGroupDetails(agentId, actionGroupId);

  await client.send(new UpdateAgentActionGroupCommand({
    agentId,
    agentVersion: 'DRAFT',
    actionGroupId,
    actionGroupName: updates.name ?? current.actionGroupName,
    actionGroupExecutor: { lambda: updates.lambdaArn ?? current.lambdaArn ?? '' },
    apiSchema: { payload: updates.apiSchemaJson ?? current.apiSchema ?? '{}' },
    ...(updates.state && { actionGroupState: updates.state }),
    ...(updates.description && { description: updates.description }),
  }));
}

/** Delete an action group */
export async function deleteActionGroup(agentId: string, actionGroupId: string): Promise<void> {
  // Must disable first
  try {
    await client.send(new UpdateAgentActionGroupCommand({
      agentId,
      agentVersion: 'DRAFT',
      actionGroupId,
      actionGroupName: (await getActionGroupDetails(agentId, actionGroupId)).actionGroupName,
      actionGroupState: 'DISABLED',
      actionGroupExecutor: { lambda: (await getActionGroupDetails(agentId, actionGroupId)).lambdaArn ?? '' },
    }));
  } catch { /* may already be disabled */ }

  await client.send(new DeleteAgentActionGroupCommand({
    agentId,
    agentVersion: 'DRAFT',
    actionGroupId,
    skipResourceInUseCheck: true,
  }));
}

// ── Knowledge Base Links (on agent) ───────────────────────────────────────────

/** List knowledge bases associated with an agent */
export async function listAgentKnowledgeBases(agentId: string): Promise<Array<{
  knowledgeBaseId: string;
  knowledgeBaseState: string;
  description?: string;
}>> {
  const res = await client.send(new ListAgentKnowledgeBasesCommand({
    agentId,
    agentVersion: 'DRAFT',
  }));
  return (res.agentKnowledgeBaseSummaries ?? []).map(kb => ({
    knowledgeBaseId: kb.knowledgeBaseId ?? '',
    knowledgeBaseState: kb.knowledgeBaseState ?? '',
    description: kb.description,
  }));
}

/** List aliases for an agent */
export async function listAliases(agentId: string): Promise<Array<{
  agentAliasId: string;
  agentAliasName: string;
  agentAliasStatus: string;
}>> {
  const res = await client.send(new ListAgentAliasesCommand({ agentId }));
  return (res.agentAliasSummaries ?? []).map(a => ({
    agentAliasId: a.agentAliasId ?? '',
    agentAliasName: a.agentAliasName ?? '',
    agentAliasStatus: a.agentAliasStatus ?? '',
  }));
}
