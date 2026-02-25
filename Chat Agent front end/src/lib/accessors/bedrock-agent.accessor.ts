import { Injectable } from '@angular/core';
import {
  BedrockAgentClient,
  CreateAgentCommand,
  UpdateAgentCommand,
  GetAgentCommand,
  DeleteAgentCommand,
  PrepareAgentCommand,
  CreateAgentAliasCommand,
  UpdateAgentAliasCommand,
  GetAgentAliasCommand,
  AssociateAgentKnowledgeBaseCommand,
  DisassociateAgentKnowledgeBaseCommand,
} from '@aws-sdk/client-bedrock-agent';
import { IAccessorResult } from '../models/tenant.model';
import { IModelConfig } from '../models/tenant.model';
import { BaseAccessor } from './base.accessor';
import { environment } from '../../environments/environment';

export interface IAgentInfo {
  agentId: string;
  agentName: string;
  agentStatus: string;
  agentArn: string;
  foundationModel: string;
  instruction: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentAliasInfo {
  agentId: string;
  agentAliasId: string;
  agentAliasName: string;
  agentAliasStatus: string;
}

/**
 * Accessor for AWS Bedrock Agent operations.
 * Manages agent lifecycle, alias versioning, and KB associations.
 */
@Injectable({ providedIn: 'root' })
export class BedrockAgentAccessor extends BaseAccessor {
  private readonly client = new BedrockAgentClient({ region: environment.aws.region });

  /** Create a new Bedrock Agent */
  async createAgent(
    name: string,
    modelConfig: IModelConfig,
    agentRoleArn: string
  ): Promise<IAccessorResult<IAgentInfo>> {
    return this.execute(async () => {
      const response = await this.client.send(new CreateAgentCommand({
        agentName: name,
        foundationModel: modelConfig.modelId,
        instruction: modelConfig.systemPrompt,
        agentResourceRoleArn: agentRoleArn,
        idleSessionTTLInSeconds: 600,
        promptOverrideConfiguration: {
          promptConfigurations: [{
            promptType: 'ORCHESTRATION',
            inferenceConfiguration: {
              temperature: modelConfig.temperature,
              topP: modelConfig.topP,
              topK: modelConfig.topK,
              maximumLength: modelConfig.maxTokens,
              stopSequences: modelConfig.stopSequences,
            },
            promptCreationMode: 'OVERRIDDEN',
            promptState: 'ENABLED',
          }],
        },
      }));

      const agent = response.agent!;
      return {
        agentId: agent.agentId!,
        agentName: agent.agentName!,
        agentStatus: agent.agentStatus!,
        agentArn: agent.agentArn!,
        foundationModel: agent.foundationModel!,
        instruction: agent.instruction!,
        createdAt: agent.createdAt!,
        updatedAt: agent.updatedAt!,
      };
    });
  }

  /** Update model configuration on an existing agent */
  async updateAgent(
    agentId: string,
    name: string,
    modelConfig: IModelConfig,
    agentRoleArn: string
  ): Promise<IAccessorResult<IAgentInfo>> {
    return this.execute(async () => {
      const response = await this.client.send(new UpdateAgentCommand({
        agentId,
        agentName: name,
        foundationModel: modelConfig.modelId,
        instruction: modelConfig.systemPrompt,
        agentResourceRoleArn: agentRoleArn,
        idleSessionTTLInSeconds: 600,
        promptOverrideConfiguration: {
          promptConfigurations: [{
            promptType: 'ORCHESTRATION',
            inferenceConfiguration: {
              temperature: modelConfig.temperature,
              topP: modelConfig.topP,
              topK: modelConfig.topK,
              maximumLength: modelConfig.maxTokens,
              stopSequences: modelConfig.stopSequences,
            },
            promptCreationMode: 'OVERRIDDEN',
            promptState: 'ENABLED',
          }],
        },
      }));
      const agent = response.agent!;
      return {
        agentId: agent.agentId!,
        agentName: agent.agentName!,
        agentStatus: agent.agentStatus!,
        agentArn: agent.agentArn!,
        foundationModel: agent.foundationModel!,
        instruction: agent.instruction!,
        createdAt: agent.createdAt!,
        updatedAt: agent.updatedAt!,
      };
    });
  }

  /** Get agent status */
  async getAgent(agentId: string): Promise<IAccessorResult<IAgentInfo>> {
    return this.execute(async () => {
      const response = await this.client.send(new GetAgentCommand({ agentId }));
      const agent = response.agent!;
      return {
        agentId: agent.agentId!,
        agentName: agent.agentName!,
        agentStatus: agent.agentStatus!,
        agentArn: agent.agentArn!,
        foundationModel: agent.foundationModel!,
        instruction: agent.instruction!,
        createdAt: agent.createdAt!,
        updatedAt: agent.updatedAt!,
      };
    });
  }

  /** Delete an agent */
  async deleteAgent(agentId: string): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new DeleteAgentCommand({ agentId, skipResourceInUseCheck: false }));
    });
  }

  /** Prepare agent (builds a new version for deployment) */
  async prepareAgent(agentId: string): Promise<IAccessorResult<string>> {
    return this.execute(async () => {
      const response = await this.client.send(new PrepareAgentCommand({ agentId }));
      return response.agentStatus ?? '';
    });
  }

  /** Create a deployment alias pointing to a specific agent version */
  async createAlias(
    agentId: string, aliasName: string, agentVersion: string
  ): Promise<IAccessorResult<IAgentAliasInfo>> {
    return this.execute(async () => {
      const response = await this.client.send(new CreateAgentAliasCommand({
        agentId,
        agentAliasName: aliasName,
        routingConfiguration: [{ agentVersion }],
      }));
      const alias = response.agentAlias!;
      return {
        agentId,
        agentAliasId: alias.agentAliasId!,
        agentAliasName: alias.agentAliasName!,
        agentAliasStatus: alias.agentAliasStatus!,
      };
    });
  }

  /** Update alias to point to a new version */
  async updateAlias(
    agentId: string, agentAliasId: string, agentVersion: string
  ): Promise<IAccessorResult<IAgentAliasInfo>> {
    return this.execute(async () => {
      const response = await this.client.send(new UpdateAgentAliasCommand({
        agentId,
        agentAliasId,
        agentAliasName: 'production',
        routingConfiguration: [{ agentVersion }],
      }));
      const alias = response.agentAlias!;
      return {
        agentId,
        agentAliasId: alias.agentAliasId!,
        agentAliasName: alias.agentAliasName!,
        agentAliasStatus: alias.agentAliasStatus!,
      };
    });
  }

  /** Associate a Knowledge Base with an agent */
  async associateKnowledgeBase(
    agentId: string,
    agentVersion: string,
    knowledgeBaseId: string,
    description: string
  ): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new AssociateAgentKnowledgeBaseCommand({
        agentId,
        agentVersion,
        knowledgeBaseId,
        description,
        knowledgeBaseState: 'ENABLED',
      }));
    });
  }

  /** Disassociate a Knowledge Base from an agent */
  async disassociateKnowledgeBase(
    agentId: string, agentVersion: string, knowledgeBaseId: string
  ): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new DisassociateAgentKnowledgeBaseCommand({
        agentId,
        agentVersion,
        knowledgeBaseId,
      }));
    });
  }
}
