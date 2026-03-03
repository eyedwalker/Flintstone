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
