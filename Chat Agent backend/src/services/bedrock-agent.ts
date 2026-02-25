import {
  BedrockAgentClient,
  CreateAgentCommand,
  UpdateAgentCommand,
  DeleteAgentCommand,
  PrepareAgentCommand,
  CreateAgentAliasCommand,
  UpdateAgentAliasCommand,
  AssociateAgentKnowledgeBaseCommand,
  DisassociateAgentKnowledgeBaseCommand,
} from '@aws-sdk/client-bedrock-agent';

const client = new BedrockAgentClient({ region: process.env['REGION'] ?? 'us-east-1' });

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
  const res = await client.send(new CreateAgentCommand({
    agentName: name,
    foundationModel: modelConfig.modelId,
    instruction: modelConfig.systemPrompt ?? `You are a helpful AI assistant for ${name}.`,
    agentResourceRoleArn: agentRoleArn,
    idleSessionTTLInSeconds: 600,
    promptOverrideConfiguration: {
      promptConfigurations: [{
        promptType: 'ORCHESTRATION',
        inferenceConfiguration: {
          temperature: modelConfig.temperature ?? 0.7,
          topP: modelConfig.topP ?? 0.9,
          topK: modelConfig.topK ?? 250,
          maximumLength: modelConfig.maxTokens ?? 2048,
          stopSequences: modelConfig.stopSequences ?? [],
        },
        promptCreationMode: 'OVERRIDDEN',
        promptState: 'ENABLED',
      }],
    },
  }));
  return {
    agentId: res.agent?.agentId ?? '',
    agentStatus: res.agent?.agentStatus ?? '',
  };
}

export async function updateAgent(
  agentId: string,
  name: string,
  modelConfig: ModelConfig,
  agentRoleArn: string
): Promise<void> {
  await client.send(new UpdateAgentCommand({
    agentId,
    agentName: name,
    foundationModel: modelConfig.modelId,
    instruction: modelConfig.systemPrompt ?? '',
    agentResourceRoleArn: agentRoleArn,
    idleSessionTTLInSeconds: 600,
    promptOverrideConfiguration: {
      promptConfigurations: [{
        promptType: 'ORCHESTRATION',
        inferenceConfiguration: {
          temperature: modelConfig.temperature ?? 0.7,
          topP: modelConfig.topP ?? 0.9,
          topK: modelConfig.topK ?? 250,
          maximumLength: modelConfig.maxTokens ?? 2048,
          stopSequences: modelConfig.stopSequences ?? [],
        },
        promptCreationMode: 'OVERRIDDEN',
        promptState: 'ENABLED',
      }],
    },
  }));
}

export async function deleteAgent(agentId: string): Promise<void> {
  await client.send(new DeleteAgentCommand({ agentId, skipResourceInUseCheck: false }));
}

export async function prepareAgent(agentId: string): Promise<void> {
  await client.send(new PrepareAgentCommand({ agentId }));
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
