import { Injectable } from '@angular/core';
import {
  BedrockAgentClient,
  CreateKnowledgeBaseCommand,
  GetKnowledgeBaseCommand,
  DeleteKnowledgeBaseCommand,
  CreateDataSourceCommand,
  DeleteDataSourceCommand,
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  ListIngestionJobsCommand,
} from '@aws-sdk/client-bedrock-agent';
import { IAccessorResult } from '../models/tenant.model';
import { IIngestionJob } from '../models/knowledge-base.model';
import { BaseAccessor } from './base.accessor';
import { environment } from '../../environments/environment';

export interface IKnowledgeBaseInfo {
  knowledgeBaseId: string;
  name: string;
  status: string;
  roleArn: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDataSourceInfo {
  dataSourceId: string;
  name: string;
  status: string;
  knowledgeBaseId: string;
}

/**
 * Accessor for AWS Bedrock Knowledge Base operations.
 * Manages creation, data source attachment, and ingestion jobs.
 */
@Injectable({ providedIn: 'root' })
export class BedrockKnowledgeBaseAccessor extends BaseAccessor {
  private readonly client = new BedrockAgentClient({ region: environment.aws.region });

  /** Create a new Bedrock Knowledge Base backed by OpenSearch Serverless */
  async createKnowledgeBase(
    name: string,
    roleArn: string,
    collectionArn: string
  ): Promise<IAccessorResult<IKnowledgeBaseInfo>> {
    return this.execute(async () => {
      const response = await this.client.send(new CreateKnowledgeBaseCommand({
        name,
        roleArn,
        knowledgeBaseConfiguration: {
          type: 'VECTOR',
          vectorKnowledgeBaseConfiguration: {
            embeddingModelArn: environment.aws.bedrockEmbeddingModelArn,
          },
        },
        storageConfiguration: {
          type: 'OPENSEARCH_SERVERLESS',
          opensearchServerlessConfiguration: {
            collectionArn,
            vectorIndexName: `${name.toLowerCase().replace(/\s+/g, '-')}-index`,
            fieldMapping: {
              vectorField: 'embedding',
              textField: 'text',
              metadataField: 'metadata',
            },
          },
        },
      }));

      const kb = response.knowledgeBase!;
      return {
        knowledgeBaseId: kb.knowledgeBaseId!,
        name: kb.name!,
        status: kb.status!,
        roleArn: kb.roleArn!,
        createdAt: kb.createdAt!,
        updatedAt: kb.updatedAt!,
      };
    });
  }

  /** Get knowledge base status */
  async getKnowledgeBase(knowledgeBaseId: string): Promise<IAccessorResult<IKnowledgeBaseInfo>> {
    return this.execute(async () => {
      const response = await this.client.send(
        new GetKnowledgeBaseCommand({ knowledgeBaseId })
      );
      const kb = response.knowledgeBase!;
      return {
        knowledgeBaseId: kb.knowledgeBaseId!,
        name: kb.name!,
        status: kb.status!,
        roleArn: kb.roleArn!,
        createdAt: kb.createdAt!,
        updatedAt: kb.updatedAt!,
      };
    });
  }

  /** Delete a knowledge base */
  async deleteKnowledgeBase(knowledgeBaseId: string): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new DeleteKnowledgeBaseCommand({ knowledgeBaseId }));
    });
  }

  /** Add an S3 data source to a knowledge base */
  async createS3DataSource(
    knowledgeBaseId: string,
    name: string,
    bucketArn: string,
    prefix: string
  ): Promise<IAccessorResult<IDataSourceInfo>> {
    return this.execute(async () => {
      const response = await this.client.send(new CreateDataSourceCommand({
        knowledgeBaseId,
        name,
        dataSourceConfiguration: {
          type: 'S3',
          s3Configuration: {
            bucketArn,
            inclusionPrefixes: [prefix],
          },
        },
        vectorIngestionConfiguration: {
          chunkingConfiguration: {
            chunkingStrategy: 'FIXED_SIZE',
            fixedSizeChunkingConfiguration: {
              maxTokens: 512,
              overlapPercentage: 20,
            },
          },
        },
      }));
      const ds = response.dataSource!;
      return {
        dataSourceId: ds.dataSourceId!,
        name: ds.name!,
        status: ds.status!,
        knowledgeBaseId: ds.knowledgeBaseId!,
      };
    });
  }

  /** Delete a data source */
  async deleteDataSource(
    knowledgeBaseId: string, dataSourceId: string
  ): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new DeleteDataSourceCommand({ knowledgeBaseId, dataSourceId }));
    });
  }

  /** Start an ingestion job to sync S3 content into the knowledge base */
  async startIngestionJob(
    knowledgeBaseId: string,
    dataSourceId: string
  ): Promise<IAccessorResult<IIngestionJob>> {
    return this.execute(async () => {
      const response = await this.client.send(new StartIngestionJobCommand({
        knowledgeBaseId,
        dataSourceId,
      }));
      const job = response.ingestionJob!;
      return this.mapIngestionJob(job, knowledgeBaseId, dataSourceId);
    });
  }

  /** Get status of an ingestion job */
  async getIngestionJob(
    knowledgeBaseId: string,
    dataSourceId: string,
    ingestionJobId: string
  ): Promise<IAccessorResult<IIngestionJob>> {
    return this.execute(async () => {
      const response = await this.client.send(new GetIngestionJobCommand({
        knowledgeBaseId,
        dataSourceId,
        ingestionJobId,
      }));
      return this.mapIngestionJob(response.ingestionJob!, knowledgeBaseId, dataSourceId);
    });
  }

  /** List recent ingestion jobs */
  async listIngestionJobs(
    knowledgeBaseId: string,
    dataSourceId: string
  ): Promise<IAccessorResult<IIngestionJob[]>> {
    return this.execute(async () => {
      const response = await this.client.send(new ListIngestionJobsCommand({
        knowledgeBaseId,
        dataSourceId,
      }));
      return (response.ingestionJobSummaries ?? []).map((j) =>
        this.mapIngestionJob(j, knowledgeBaseId, dataSourceId)
      );
    });
  }

  private mapIngestionJob(job: unknown, knowledgeBaseId: string, dataSourceId: string): IIngestionJob {
    const j = job as Record<string, unknown>;
    return {
      jobId: (j['ingestionJobId'] as string) ?? '',
      knowledgeBaseId,
      dataSourceId,
      status: (j['status'] as IIngestionJob['status']) ?? 'STARTING',
      statistics: j['statistics'] as IIngestionJob['statistics'],
      startedAt: String(j['startedAt'] ?? ''),
      updatedAt: String(j['updatedAt'] ?? ''),
    };
  }
}
