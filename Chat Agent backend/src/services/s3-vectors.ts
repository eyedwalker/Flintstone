import {
  S3VectorsClient,
  CreateVectorBucketCommand,
  CreateIndexCommand,
  GetVectorBucketCommand,
  GetIndexCommand,
  DeleteIndexCommand,
  DeleteVectorBucketCommand,
} from '@aws-sdk/client-s3vectors';

const client = new S3VectorsClient({ region: process.env['REGION'] ?? 'us-west-2' });

// Titan Embed Text v2 outputs 1024-dimensional float32 vectors
const EMBEDDING_DIMENSION = 1024;

/**
 * Create an S3 Vectors bucket and a vector index inside it (idempotent).
 * If the bucket or index already exists they are reused.
 * Returns the bucket ARN and index ARN needed for Bedrock Knowledge Base.
 */
export async function createVectorStore(
  bucketName: string,
  indexName: string
): Promise<{ vectorBucketArn: string; indexArn: string }> {
  // Create bucket — ignore "already exists" error
  try {
    await client.send(new CreateVectorBucketCommand({ vectorBucketName: bucketName }));
  } catch (e: any) {
    const code = e?.name ?? e?.Code ?? '';
    if (!code.includes('Conflict') && !code.includes('AlreadyExists') && !code.includes('BucketAlreadyExists')) {
      throw e;
    }
  }

  // Get the bucket ARN
  const bucketRes = await client.send(new GetVectorBucketCommand({ vectorBucketName: bucketName }));
  const vectorBucketArn = bucketRes.vectorBucket?.vectorBucketArn ?? '';
  if (!vectorBucketArn) throw new Error(`Failed to get ARN for vector bucket: ${bucketName}`);

  // Create index — ignore "already exists" error
  try {
    await client.send(new CreateIndexCommand({
      vectorBucketName: bucketName,
      indexName,
      dataType: 'float32',
      dimension: EMBEDDING_DIMENSION,
      distanceMetric: 'cosine',
      metadataConfiguration: {
        nonFilterableMetadataKeys: [
          'AMAZON_BEDROCK_TEXT',
          'AMAZON_BEDROCK_METADATA',
        ],
      },
    }));
  } catch (e: any) {
    const code = e?.name ?? e?.Code ?? '';
    if (!code.includes('Conflict') && !code.includes('AlreadyExists') && !code.includes('IndexAlreadyExists')) {
      throw e;
    }
  }

  // Get the index ARN
  const indexRes = await client.send(new GetIndexCommand({ vectorBucketName: bucketName, indexName }));
  const indexArn = indexRes.index?.indexArn ?? '';
  if (!indexArn) throw new Error(`Failed to get ARN for vector index: ${indexName}`);

  return { vectorBucketArn, indexArn };
}

export async function deleteVectorStore(bucketName: string, indexName: string): Promise<void> {
  try {
    await client.send(new DeleteIndexCommand({ vectorBucketName: bucketName, indexName }));
  } catch { /* ignore if already deleted */ }
  try {
    await client.send(new DeleteVectorBucketCommand({ vectorBucketName: bucketName }));
  } catch { /* ignore if already deleted */ }
}
