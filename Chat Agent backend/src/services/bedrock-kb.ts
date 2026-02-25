import {
  BedrockAgentClient,
  CreateKnowledgeBaseCommand,
  GetKnowledgeBaseCommand,
  DeleteKnowledgeBaseCommand,
  CreateDataSourceCommand,
  DeleteDataSourceCommand,
  StartIngestionJobCommand,
  GetIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';

const client = new BedrockAgentClient({ region: process.env['REGION'] ?? 'us-west-2' });
const EMBEDDING_MODEL = process.env['BEDROCK_EMBEDDING_MODEL_ARN'] ?? '';

export async function createKnowledgeBase(
  name: string,
  roleArn: string,
  vectorBucketArn: string,
  indexArn: string,
  indexName: string
): Promise<{ knowledgeBaseId: string; knowledgeBaseArn: string }> {
  const res = await client.send(new CreateKnowledgeBaseCommand({
    name,
    roleArn,
    knowledgeBaseConfiguration: {
      type: 'VECTOR',
      vectorKnowledgeBaseConfiguration: { embeddingModelArn: EMBEDDING_MODEL },
    },
    storageConfiguration: {
      type: 'S3_VECTORS',
      s3VectorsConfiguration: { vectorBucketArn, indexArn, indexName },
    },
  }));
  return {
    knowledgeBaseId: res.knowledgeBase?.knowledgeBaseId ?? '',
    knowledgeBaseArn: res.knowledgeBase?.knowledgeBaseArn ?? '',
  };
}

export async function getKnowledgeBase(knowledgeBaseId: string): Promise<{ status: string }> {
  const res = await client.send(new GetKnowledgeBaseCommand({ knowledgeBaseId }));
  return { status: res.knowledgeBase?.status ?? '' };
}

export async function deleteKnowledgeBase(knowledgeBaseId: string): Promise<void> {
  await client.send(new DeleteKnowledgeBaseCommand({ knowledgeBaseId }));
}

export async function createS3DataSource(
  knowledgeBaseId: string,
  name: string,
  bucketArn: string,
  prefix: string
): Promise<{ dataSourceId: string }> {
  const res = await client.send(new CreateDataSourceCommand({
    knowledgeBaseId,
    name,
    dataSourceConfiguration: {
      type: 'S3',
      s3Configuration: { bucketArn, inclusionPrefixes: [prefix] },
    },
    vectorIngestionConfiguration: {
      chunkingConfiguration: {
        chunkingStrategy: 'FIXED_SIZE',
        fixedSizeChunkingConfiguration: { maxTokens: 512, overlapPercentage: 20 },
      },
    },
  }));
  return { dataSourceId: res.dataSource?.dataSourceId ?? '' };
}

export async function deleteDataSource(
  knowledgeBaseId: string,
  dataSourceId: string
): Promise<void> {
  await client.send(new DeleteDataSourceCommand({ knowledgeBaseId, dataSourceId }));
}

export async function startIngestionJob(
  knowledgeBaseId: string,
  dataSourceId: string
): Promise<{ ingestionJobId: string }> {
  const res = await client.send(new StartIngestionJobCommand({
    knowledgeBaseId,
    dataSourceId,
  }));
  return { ingestionJobId: res.ingestionJob?.ingestionJobId ?? '' };
}

export async function getIngestionJob(
  knowledgeBaseId: string,
  dataSourceId: string,
  ingestionJobId: string
): Promise<{ status: string; statistics?: Record<string, number> }> {
  const res = await client.send(new GetIngestionJobCommand({
    knowledgeBaseId,
    dataSourceId,
    ingestionJobId,
  }));
  return {
    status: res.ingestionJob?.status ?? '',
    statistics: res.ingestionJob?.statistics as Record<string, number> | undefined,
  };
}
