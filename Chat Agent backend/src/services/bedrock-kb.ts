import {
  BedrockAgentClient,
  CreateKnowledgeBaseCommand,
  GetKnowledgeBaseCommand,
  DeleteKnowledgeBaseCommand,
  CreateDataSourceCommand,
  DeleteDataSourceCommand,
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  ListKnowledgeBasesCommand,
} from '@aws-sdk/client-bedrock-agent';

const client = new BedrockAgentClient({ region: process.env['REGION'] ?? 'us-west-2' });
const EMBEDDING_MODEL = process.env['BEDROCK_EMBEDDING_MODEL_ARN'] ?? '';

export async function createKnowledgeBase(
  name: string,
  roleArn: string,
  vectorBucketArn: string,
  indexArn: string,
): Promise<{ knowledgeBaseId: string; knowledgeBaseArn: string }> {
  try {
    const res = await client.send(new CreateKnowledgeBaseCommand({
      name,
      roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: { embeddingModelArn: EMBEDDING_MODEL },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: { vectorBucketArn, indexArn },
      },
    }));
    return {
      knowledgeBaseId: res.knowledgeBase?.knowledgeBaseId ?? '',
      knowledgeBaseArn: res.knowledgeBase?.knowledgeBaseArn ?? '',
    };
  } catch (e: any) {
    // If a KB with this name already exists, find and reuse it
    if (e?.name === 'ConflictException' || e?.message?.includes('already exists')) {
      let nextToken: string | undefined;
      do {
        const list = await client.send(new ListKnowledgeBasesCommand({ nextToken }));
        const match = list.knowledgeBaseSummaries?.find(kb => kb.name === name);
        if (match) {
          return {
            knowledgeBaseId: match.knowledgeBaseId ?? '',
            knowledgeBaseArn: '',
          };
        }
        nextToken = list.nextToken;
      } while (nextToken);
      throw new Error(`KB named '${name}' already exists but could not be found in list`);
    }
    throw e;
  }
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
  prefix: string,
  useBDA: boolean = false,
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
      ...(useBDA ? {
        parsingConfiguration: {
          parsingStrategy: 'BEDROCK_DATA_AUTOMATION' as const,
          bedrockDataAutomationConfiguration: {
            parsingModality: 'MULTIMODAL' as const,
          },
        },
      } : {}),
    },
  }));
  return { dataSourceId: res.dataSource?.dataSourceId ?? '' };
}

/**
 * Create a web crawler data source for a knowledge base.
 * crawlDepth maps to maxPages: 1→1 page, 2→50, 3→200, 4→1000, 5→5000.
 */
export async function createWebCrawlerDataSource(
  knowledgeBaseId: string,
  name: string,
  seedUrl: string,
  crawlDepth: number = 1,
  useBDA: boolean = false,
): Promise<{ dataSourceId: string }> {
  const maxPagesMap: Record<number, number> = { 1: 1, 2: 50, 3: 200, 4: 1000, 5: 5000 };
  const maxPages = maxPagesMap[Math.min(Math.max(crawlDepth, 1), 5)] ?? 1;
  const res = await client.send(new CreateDataSourceCommand({
    knowledgeBaseId,
    name,
    dataSourceConfiguration: {
      type: 'WEB',
      webConfiguration: {
        sourceConfiguration: {
          urlConfiguration: { seedUrls: [{ url: seedUrl }] },
        },
        crawlerConfiguration: {
          scope: crawlDepth <= 1 ? 'HOST_ONLY' : 'HOST_ONLY',
          crawlerLimits: { maxPages },
        },
      },
    },
    vectorIngestionConfiguration: {
      chunkingConfiguration: {
        chunkingStrategy: 'FIXED_SIZE',
        fixedSizeChunkingConfiguration: { maxTokens: 512, overlapPercentage: 20 },
      },
      ...(useBDA ? {
        parsingConfiguration: {
          parsingStrategy: 'BEDROCK_DATA_AUTOMATION' as const,
          bedrockDataAutomationConfiguration: {
            parsingModality: 'MULTIMODAL' as const,
          },
        },
      } : {}),
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
