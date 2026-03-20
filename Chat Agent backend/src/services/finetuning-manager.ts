/**
 * Fine-Tuning Job Manager — wraps AWS Bedrock model customization APIs.
 *
 * Manages the lifecycle:
 *   1. Start job (CreateModelCustomizationJob)
 *   2. Poll status (GetModelCustomizationJob)
 *   3. Deploy model (CreateProvisionedModelThroughput)
 *   4. Cancel/cleanup
 *
 * Supports Llama 3.x and Titan (Claude cannot be fine-tuned on Bedrock).
 */

import { v4 as uuidv4 } from 'uuid';
import {
  BedrockClient,
  CreateModelCustomizationJobCommand,
  GetModelCustomizationJobCommand,
  StopModelCustomizationJobCommand,
  ListCustomModelsCommand,
  CreateProvisionedModelThroughputCommand,
  DeleteProvisionedModelThroughputCommand,
  GetProvisionedModelThroughputCommand,
} from '@aws-sdk/client-bedrock';
import * as ddb from './dynamo';

const REGION = process.env['REGION'] ?? 'us-west-2';
const FINETUNING_JOBS_TABLE = process.env['FINETUNING_JOBS_TABLE'] ?? 'chat-agent-finetuning-jobs-dev';
const TRAINING_BUCKET = process.env['TRAINING_DATA_BUCKET'] ?? 'chat-agent-training-data-dev';
const FINETUNING_ROLE_ARN = process.env['FINETUNING_ROLE_ARN'] ?? '';

const bedrock = new BedrockClient({ region: REGION });

// ── Types ─────────────────────────────────────────────────────────────────────

type FineTuningStatus = 'pending' | 'validating' | 'training' | 'completed' | 'failed' | 'cancelled';

interface IHyperparameters {
  epochs: number;
  batchSize: number;
  learningRate: number;
  warmupSteps: number;
  loraRank?: number;
  loraAlpha?: number;
  loraDropout?: number;
}

interface IFineTuningJob {
  id: string;
  tenantId: string;
  assistantId: string;
  datasetId: string;
  baseModelId: string;
  customModelName: string;
  bedrockJobArn?: string;
  bedrockCustomModelArn?: string;
  provisionedModelArn?: string;
  status: FineTuningStatus;
  hyperparameters: IHyperparameters;
  trainingMetrics?: { trainingLoss: number; validationLoss: number };
  errorMessage?: string;
  iteration: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Job Management ────────────────────────────────────────────────────────────

/**
 * Start a fine-tuning job on Bedrock.
 */
export async function startFineTuning(
  assistantId: string,
  tenantId: string,
  datasetId: string,
  datasetS3Key: string,
  baseModelId: string,
  hyperparameters: IHyperparameters,
  iteration: number,
): Promise<IFineTuningJob> {
  const jobId = uuidv4();
  const customModelName = `encompass-${assistantId.slice(0, 8)}-v${iteration}-${Date.now()}`;
  const jobName = `raft-${assistantId.slice(0, 8)}-iter${iteration}-${Date.now()}`;

  const now = new Date().toISOString();
  const job: IFineTuningJob = {
    id: jobId,
    tenantId,
    assistantId,
    datasetId,
    baseModelId,
    customModelName,
    status: 'pending',
    hyperparameters,
    iteration,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const hyperParams: Record<string, string> = {
      epochCount: String(hyperparameters.epochs),
      batchSize: String(hyperparameters.batchSize),
      learningRate: String(hyperparameters.learningRate),
      warmupSteps: String(hyperparameters.warmupSteps),
    };

    const result = await bedrock.send(new CreateModelCustomizationJobCommand({
      jobName,
      customModelName,
      roleArn: FINETUNING_ROLE_ARN,
      baseModelIdentifier: baseModelId,
      customizationType: 'FINE_TUNING',
      trainingDataConfig: {
        s3Uri: `s3://${TRAINING_BUCKET}/${datasetS3Key}/train.jsonl`,
      },
      validationDataConfig: {
        validators: [{
          s3Uri: `s3://${TRAINING_BUCKET}/${datasetS3Key}/validation.jsonl`,
        }],
      },
      outputDataConfig: {
        s3Uri: `s3://${TRAINING_BUCKET}/${datasetS3Key}/output/`,
      },
      hyperParameters: hyperParams,
    }));

    job.bedrockJobArn = result.jobArn;
    job.status = 'validating';
    job.startedAt = now;
  } catch (err) {
    job.status = 'failed';
    job.errorMessage = String(err);
    console.error('[FineTuning] CreateJob failed:', err);
  }

  await ddb.putItem(FINETUNING_JOBS_TABLE, job as unknown as Record<string, unknown>);
  return job;
}

/**
 * Check the status of a fine-tuning job.
 */
export async function checkJobStatus(jobId: string): Promise<IFineTuningJob> {
  const job = await ddb.getItem<IFineTuningJob>(FINETUNING_JOBS_TABLE, { id: jobId });
  if (!job) throw new Error('Job not found');
  if (!job.bedrockJobArn || ['completed', 'failed', 'cancelled'].includes(job.status)) {
    return job;
  }

  try {
    const result = await bedrock.send(new GetModelCustomizationJobCommand({
      jobIdentifier: job.bedrockJobArn,
    }));

    const bedrockStatus = result.status;
    let newStatus: FineTuningStatus = job.status;

    switch (bedrockStatus) {
      case 'InProgress': newStatus = 'training'; break;
      case 'Completed': newStatus = 'completed'; break;
      case 'Failed': newStatus = 'failed'; break;
      case 'Stopping':
      case 'Stopped': newStatus = 'cancelled'; break;
    }

    const updates: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };

    if (newStatus === 'completed' && result.outputModelArn) {
      updates['bedrockCustomModelArn'] = result.outputModelArn;
      updates['completedAt'] = new Date().toISOString();
    }

    if (newStatus === 'failed' && result.failureMessage) {
      updates['errorMessage'] = result.failureMessage;
    }

    await ddb.updateItem(FINETUNING_JOBS_TABLE, { id: jobId }, updates);
    return { ...job, ...updates } as IFineTuningJob;
  } catch (err) {
    console.error('[FineTuning] CheckStatus failed:', err);
    return job;
  }
}

/**
 * Cancel a running fine-tuning job.
 */
export async function cancelJob(jobId: string): Promise<void> {
  const job = await ddb.getItem<IFineTuningJob>(FINETUNING_JOBS_TABLE, { id: jobId });
  if (!job?.bedrockJobArn) return;

  try {
    await bedrock.send(new StopModelCustomizationJobCommand({
      jobIdentifier: job.bedrockJobArn,
    }));
  } catch (err) {
    console.warn('[FineTuning] StopJob failed (may already be stopped):', err);
  }

  await ddb.updateItem(FINETUNING_JOBS_TABLE, { id: jobId }, {
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Deploy a completed fine-tuned model with provisioned throughput.
 */
export async function deployModel(
  jobId: string,
  modelUnits: number = 1,
): Promise<{ provisionedModelArn: string }> {
  const job = await ddb.getItem<IFineTuningJob>(FINETUNING_JOBS_TABLE, { id: jobId });
  if (!job) throw new Error('Job not found');
  if (job.status !== 'completed' || !job.bedrockCustomModelArn) {
    throw new Error('Job must be completed with a custom model ARN before deployment');
  }

  const result = await bedrock.send(new CreateProvisionedModelThroughputCommand({
    modelId: job.bedrockCustomModelArn,
    provisionedModelName: `${job.customModelName}-prov`,
    modelUnits,
  }));

  const provisionedArn = result.provisionedModelArn!;

  await ddb.updateItem(FINETUNING_JOBS_TABLE, { id: jobId }, {
    provisionedModelArn: provisionedArn,
    updatedAt: new Date().toISOString(),
  });

  return { provisionedModelArn: provisionedArn };
}

/**
 * List fine-tuning jobs for an assistant.
 */
export async function listJobs(
  assistantId: string,
  tenantId: string,
): Promise<IFineTuningJob[]> {
  const all = await ddb.queryItems<IFineTuningJob>(
    FINETUNING_JOBS_TABLE,
    'assistantId = :a',
    { ':a': assistantId },
    undefined,
    'assistantId-index',
  );
  return all.filter(j => j.tenantId === tenantId);
}

/**
 * Get a single fine-tuning job.
 */
export async function getJob(id: string): Promise<IFineTuningJob | null> {
  return ddb.getItem<IFineTuningJob>(FINETUNING_JOBS_TABLE, { id });
}

/**
 * List available base models that support fine-tuning.
 */
export function getFineTunableModels(): Array<{
  modelId: string;
  modelName: string;
  loraSupport: boolean;
  estimatedCostPerHour: string;
}> {
  return [
    {
      modelId: 'meta.llama3-1-8b-instruct-v1:0',
      modelName: 'Meta Llama 3.1 8B Instruct',
      loraSupport: true,
      estimatedCostPerHour: '$8',
    },
    {
      modelId: 'meta.llama3-1-70b-instruct-v1:0',
      modelName: 'Meta Llama 3.1 70B Instruct',
      loraSupport: true,
      estimatedCostPerHour: '$40',
    },
    {
      modelId: 'amazon.titan-text-express-v1',
      modelName: 'Amazon Titan Text Express',
      loraSupport: false,
      estimatedCostPerHour: '$8',
    },
  ];
}
