/**
 * Training Dataset Generator — converts approved trainer corrections into
 * JSONL training files for Bedrock model fine-tuning (RAFT format).
 *
 * Supports:
 *   - Bedrock Llama format: {"prompt": "...", "completion": "..."}
 *   - RAFT format: includes oracle + distractor contexts for contrastive learning
 *
 * The key RAFT insight: training examples include BOTH relevant KB chunks (oracle)
 * and irrelevant chunks (distractors). This teaches the model to extract and cite
 * from the right context, not just pattern-match on any retrieved text.
 */

import { v4 as uuidv4 } from 'uuid';
import { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as ddb from './dynamo';

const REGION = process.env['REGION'] ?? 'us-west-2';
const TEST_RESULTS_TABLE = process.env['TEST_RESULTS_TABLE'] ?? '';
const TRAINING_DATASETS_TABLE = process.env['TRAINING_DATASETS_TABLE'] ?? 'chat-agent-training-datasets-dev';
const TRAINING_BUCKET = process.env['TRAINING_DATA_BUCKET'] ?? 'chat-agent-training-data-dev';

const s3 = new S3Client({ region: REGION });

// ── Types ─────────────────────────────────────────────────────────────────────

interface ITrainingDataset {
  id: string;
  tenantId: string;
  assistantId: string;
  name: string;
  description: string;
  sourceRunIds: string[];
  format: string;
  totalExamples: number;
  s3Key: string;
  fileSizeBytes: number;
  splitConfig: { trainPct: number; validationPct: number };
  createdAt: string;
  updatedAt: string;
}

interface IApprovedResult {
  id: string;
  turns: Array<{ userMessage: string; actualResponse: string; expectedBehavior: string }>;
  trainerAnnotation: {
    corrections: Array<{
      turnIndex: number;
      idealResponse: string;
      correctionNotes?: string;
      retrievalContext?: string;
    }>;
    trainingStatus: string;
  };
}

// ── Dataset Generation ────────────────────────────────────────────────────────

/**
 * Generate a training dataset from approved test results.
 */
export async function generateDataset(
  name: string,
  assistantId: string,
  tenantId: string,
  sourceRunIds: string[],
  format: 'bedrock-llama' | 'bedrock-titan' | 'huggingface-raft' = 'bedrock-llama',
  splitConfig = { trainPct: 90, validationPct: 10 },
): Promise<ITrainingDataset> {
  // Collect all approved results across the specified runs
  const approvedResults: IApprovedResult[] = [];

  for (const runId of sourceRunIds) {
    const results = await ddb.queryItems<IApprovedResult>(
      TEST_RESULTS_TABLE, 'runId = :r', { ':r': runId }, undefined, 'runId-index',
    );
    for (const r of results) {
      if (r.trainerAnnotation?.trainingStatus === 'approved') {
        approvedResults.push(r);
      }
    }
  }

  if (approvedResults.length === 0) {
    throw new Error('No approved results found in the specified runs');
  }

  // Build training examples
  const examples = buildExamples(approvedResults, format);

  // Shuffle for randomness
  shuffle(examples);

  // Split into train/validation
  const splitIdx = Math.floor(examples.length * (splitConfig.trainPct / 100));
  const trainExamples = examples.slice(0, splitIdx);
  const validationExamples = examples.slice(splitIdx);

  // Convert to JSONL
  const trainJsonl = trainExamples.map(e => JSON.stringify(e)).join('\n');
  const validationJsonl = validationExamples.map(e => JSON.stringify(e)).join('\n');

  // Upload to S3
  const datasetId = uuidv4();
  const s3Prefix = `${tenantId}/${datasetId}`;

  await s3.send(new PutObjectCommand({
    Bucket: TRAINING_BUCKET,
    Key: `${s3Prefix}/train.jsonl`,
    Body: trainJsonl,
    ContentType: 'application/jsonl',
  }));

  if (validationExamples.length > 0) {
    await s3.send(new PutObjectCommand({
      Bucket: TRAINING_BUCKET,
      Key: `${s3Prefix}/validation.jsonl`,
      Body: validationJsonl,
      ContentType: 'application/jsonl',
    }));
  }

  const totalBytes = Buffer.byteLength(trainJsonl, 'utf-8') + Buffer.byteLength(validationJsonl, 'utf-8');

  // Save metadata
  const dataset: ITrainingDataset = {
    id: datasetId,
    tenantId,
    assistantId,
    name,
    description: `Generated from ${sourceRunIds.length} test run(s), ${approvedResults.length} approved results`,
    sourceRunIds,
    format,
    totalExamples: examples.length,
    s3Key: s3Prefix,
    fileSizeBytes: totalBytes,
    splitConfig,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await ddb.putItem(TRAINING_DATASETS_TABLE, dataset as unknown as Record<string, unknown>);

  console.log(`[TrainingDataset] Generated ${examples.length} examples (${trainExamples.length} train, ${validationExamples.length} validation)`);
  return dataset;
}

/**
 * Preview what a dataset would look like without generating it.
 */
export async function previewDataset(
  assistantId: string,
  tenantId: string,
  runIds: string[],
): Promise<{ totalApproved: number; sampleExamples: unknown[]; estimatedTokens: number }> {
  const approvedResults: IApprovedResult[] = [];

  for (const runId of runIds) {
    const results = await ddb.queryItems<IApprovedResult>(
      TEST_RESULTS_TABLE, 'runId = :r', { ':r': runId }, undefined, 'runId-index',
    );
    for (const r of results) {
      if (r.trainerAnnotation?.trainingStatus === 'approved') {
        approvedResults.push(r);
      }
    }
  }

  const examples = buildExamples(approvedResults.slice(0, 5), 'bedrock-llama');
  const allExamples = buildExamples(approvedResults, 'bedrock-llama');

  // Rough token estimate: ~4 chars per token
  const totalChars = allExamples.reduce((sum, e) => {
    const ex = e as { prompt: string; completion: string };
    return sum + (ex.prompt?.length ?? 0) + (ex.completion?.length ?? 0);
  }, 0);

  return {
    totalApproved: approvedResults.length,
    sampleExamples: examples,
    estimatedTokens: Math.ceil(totalChars / 4),
  };
}

/**
 * List datasets for an assistant.
 */
export async function listDatasets(
  assistantId: string,
  tenantId: string,
): Promise<ITrainingDataset[]> {
  const all = await ddb.queryItems<ITrainingDataset>(
    TRAINING_DATASETS_TABLE,
    'assistantId = :a',
    { ':a': assistantId },
    undefined,
    'assistantId-index',
  );
  return all.filter(d => d.tenantId === tenantId);
}

/**
 * Get a single dataset.
 */
export async function getDataset(id: string): Promise<ITrainingDataset | null> {
  return ddb.getItem<ITrainingDataset>(TRAINING_DATASETS_TABLE, { id });
}

/**
 * Delete a dataset and its S3 files.
 */
export async function deleteDataset(id: string, tenantId: string): Promise<void> {
  const dataset = await getDataset(id);
  if (!dataset || dataset.tenantId !== tenantId) return;

  // Delete S3 objects
  try {
    const listResult = await s3.send(new ListObjectsV2Command({
      Bucket: TRAINING_BUCKET,
      Prefix: dataset.s3Key,
    }));
    const objects = listResult.Contents?.map(o => ({ Key: o.Key! })) ?? [];
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: TRAINING_BUCKET,
        Delete: { Objects: objects },
      }));
    }
  } catch (err) {
    console.warn('[TrainingDataset] Failed to delete S3 objects:', err);
  }

  // Delete DynamoDB record
  await ddb.deleteItem(TRAINING_DATASETS_TABLE, { id });
}

// ── Example Builders ──────────────────────────────────────────────────────────

function buildExamples(
  results: IApprovedResult[],
  format: string,
): Record<string, unknown>[] {
  const examples: Record<string, unknown>[] = [];

  for (const result of results) {
    if (!result.trainerAnnotation?.corrections?.length) continue;

    for (const correction of result.trainerAnnotation.corrections) {
      const turn = result.turns[correction.turnIndex];
      if (!turn) continue;

      const userMessage = turn.userMessage;
      const idealResponse = correction.idealResponse;
      const retrievalContext = correction.retrievalContext ?? '';

      switch (format) {
        case 'bedrock-llama': {
          // Bedrock Llama fine-tuning format
          let prompt = '';
          if (retrievalContext) {
            prompt = `### Context:\n${retrievalContext}\n\n### Question:\n${userMessage}`;
          } else {
            prompt = userMessage;
          }
          examples.push({ prompt, completion: idealResponse });
          break;
        }

        case 'bedrock-titan': {
          // Amazon Titan fine-tuning format (same structure)
          examples.push({ prompt: userMessage, completion: idealResponse });
          break;
        }

        case 'huggingface-raft': {
          // RAFT format with oracle/distractor contexts
          const contexts: { text: string; is_oracle: boolean }[] = [];
          if (retrievalContext) {
            contexts.push({ text: retrievalContext, is_oracle: true });
          }
          // TODO: Add distractor contexts from random KB chunks
          examples.push({
            instruction: 'Answer based on the provided context. Cite relevant passages.',
            context: contexts,
            question: userMessage,
            answer: idealResponse,
          });
          break;
        }
      }
    }
  }

  return examples;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
