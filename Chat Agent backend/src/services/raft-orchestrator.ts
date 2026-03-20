/**
 * RAFT Orchestrator — manages the full RAFT cycle lifecycle.
 *
 * State machine:
 *   testing → reviewing → training → deploying → retesting → completed
 *
 * Each iteration tracks: test run, dataset, fine-tuning job, scores, status.
 */

import { v4 as uuidv4 } from 'uuid';
import * as ddb from './dynamo';

const RAFT_ITERATIONS_TABLE = process.env['RAFT_ITERATIONS_TABLE'] ?? 'chat-agent-raft-iterations-dev';
const TEST_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
const TEST_RESULTS_TABLE = process.env['TEST_RESULTS_TABLE'] ?? '';
const FINETUNING_JOBS_TABLE = process.env['FINETUNING_JOBS_TABLE'] ?? 'chat-agent-finetuning-jobs-dev';
const TRAINING_DATASETS_TABLE = process.env['TRAINING_DATASETS_TABLE'] ?? 'chat-agent-training-datasets-dev';

type RaftStatus = 'testing' | 'reviewing' | 'training' | 'deploying' | 'retesting' | 'completed';

interface IRaftIteration {
  id: string;
  tenantId: string;
  assistantId: string;
  iterationNumber: number;
  testRunId: string;
  datasetId?: string;
  fineTuningJobId?: string;
  ragImprovementIds?: string[];
  baselineScore: number;
  improvedScore?: number;
  reformulatedPromptPct: number;
  status: RaftStatus;
  track: 'rag' | 'finetune' | 'hybrid';
  createdAt: string;
  updatedAt: string;
}

/**
 * Start a new RAFT cycle.
 */
export async function startCycle(
  assistantId: string,
  tenantId: string,
  testRunId: string,
  config: {
    track: 'rag' | 'finetune' | 'hybrid';
    reformulationPct?: number;
  },
): Promise<IRaftIteration> {
  // Get the current iteration number
  const history = await getHistory(assistantId, tenantId);
  const iterationNumber = history.length + 1;

  // Get baseline score from the test run
  const testRun = await ddb.getItem<{ avgScore: number }>(TEST_RUNS_TABLE, { id: testRunId });
  const baselineScore = testRun?.avgScore ?? 0;

  const now = new Date().toISOString();
  const iteration: IRaftIteration = {
    id: uuidv4(),
    tenantId,
    assistantId,
    iterationNumber,
    testRunId,
    baselineScore,
    reformulatedPromptPct: config.reformulationPct ?? 0.3,
    status: 'reviewing', // starts in reviewing since test already ran
    track: config.track,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.putItem(RAFT_ITERATIONS_TABLE, iteration as unknown as Record<string, unknown>);
  return iteration;
}

/**
 * Check prerequisites for advancing to the next state.
 * Returns { canAdvance, reason, approvedCount, ... }
 */
export async function checkPrerequisites(
  iterationId: string,
): Promise<{ canAdvance: boolean; reason?: string; details: Record<string, unknown> }> {
  const iteration = await ddb.getItem<IRaftIteration>(RAFT_ITERATIONS_TABLE, { id: iterationId });
  if (!iteration) throw new Error('Iteration not found');

  switch (iteration.status) {
    case 'reviewing': {
      // Must have at least 5 approved results before advancing to training
      const results = await ddb.queryItems<any>(
        TEST_RESULTS_TABLE, 'runId = :r', { ':r': iteration.testRunId }, undefined, 'runId-index',
      );
      const approved = results.filter((r: any) => r.trainerAnnotation?.trainingStatus === 'approved');
      if (approved.length < 5) {
        return {
          canAdvance: false,
          reason: `Need at least 5 approved results to advance (currently ${approved.length}). Go to Test Suites → review results → mark as Approved.`,
          details: { approvedCount: approved.length, totalResults: results.length },
        };
      }
      return { canAdvance: true, details: { approvedCount: approved.length, totalResults: results.length } };
    }

    case 'training': {
      // Must have a dataset generated before advancing to deploying
      if (!iteration.datasetId) {
        // Check if any datasets exist for this assistant
        const datasets = await ddb.queryItems<any>(
          TRAINING_DATASETS_TABLE, 'assistantId = :a', { ':a': iteration.assistantId }, undefined, 'assistantId-index',
        );
        if (datasets.length === 0) {
          return {
            canAdvance: false,
            reason: 'Generate a training dataset before advancing. Click "Generate Dataset" in the Training Datasets panel.',
            details: { hasDataset: false },
          };
        }
      }

      // If using finetune track, check for a completed fine-tuning job
      if (iteration.track === 'finetune' || iteration.track === 'hybrid') {
        if (iteration.fineTuningJobId) {
          const job = await ddb.getItem<any>(FINETUNING_JOBS_TABLE, { id: iteration.fineTuningJobId });
          if (job && job.status !== 'completed') {
            return {
              canAdvance: false,
              reason: `Fine-tuning job is still ${job.status}. Wait for it to complete.`,
              details: { jobStatus: job.status },
            };
          }
        }
      }
      return { canAdvance: true, details: {} };
    }

    case 'deploying': {
      // For finetune track, must have deployed the model
      if (iteration.track === 'finetune' || iteration.track === 'hybrid') {
        if (iteration.fineTuningJobId) {
          const job = await ddb.getItem<any>(FINETUNING_JOBS_TABLE, { id: iteration.fineTuningJobId });
          if (job && !job.provisionedModelArn && job.status === 'completed') {
            return {
              canAdvance: false,
              reason: 'Deploy the fine-tuned model before retesting. Click "Deploy" on the completed job.',
              details: { hasProvisionedModel: false },
            };
          }
        }
      }
      // RAG track can always advance (improvements already applied)
      return { canAdvance: true, details: {} };
    }

    case 'retesting': {
      // Must have a re-test run with an improved score
      if (!iteration.improvedScore) {
        return {
          canAdvance: false,
          reason: 'Run the test suite again to get an improved score before completing.',
          details: { hasImprovedScore: false },
        };
      }
      return { canAdvance: true, details: {} };
    }

    default:
      return { canAdvance: true, details: {} };
  }
}

/**
 * Advance the cycle to the next state (with prerequisite validation).
 */
export async function advanceCycle(
  iterationId: string,
  updates: Partial<IRaftIteration> = {},
): Promise<IRaftIteration & { prerequisiteError?: string }> {
  const iteration = await ddb.getItem<IRaftIteration>(RAFT_ITERATIONS_TABLE, { id: iterationId });
  if (!iteration) throw new Error('Iteration not found');

  // Check prerequisites
  const prereq = await checkPrerequisites(iterationId);
  if (!prereq.canAdvance) {
    return { ...iteration, prerequisiteError: prereq.reason };
  }

  const transitions: Record<RaftStatus, RaftStatus> = {
    testing: 'reviewing',
    reviewing: 'training',
    training: 'deploying',
    deploying: 'retesting',
    retesting: 'completed',
    completed: 'completed',
  };

  const nextStatus = transitions[iteration.status];
  const merged = {
    ...updates,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  };

  await ddb.updateItem(RAFT_ITERATIONS_TABLE, { id: iterationId }, merged);
  return { ...iteration, ...merged };
}

/**
 * Get iteration history for an assistant.
 */
export async function getHistory(
  assistantId: string,
  tenantId: string,
): Promise<IRaftIteration[]> {
  const all = await ddb.queryItems<IRaftIteration>(
    RAFT_ITERATIONS_TABLE,
    'assistantId = :a',
    { ':a': assistantId },
    undefined,
    'assistantId-index',
  );
  return all
    .filter(i => i.tenantId === tenantId)
    .sort((a, b) => a.iterationNumber - b.iterationNumber);
}

/**
 * Get a single iteration.
 */
export async function getIteration(id: string): Promise<IRaftIteration | null> {
  return ddb.getItem<IRaftIteration>(RAFT_ITERATIONS_TABLE, { id });
}

/**
 * Update an iteration with new data (dataset, job, scores).
 */
export async function updateIteration(
  id: string,
  updates: Partial<IRaftIteration>,
): Promise<void> {
  await ddb.updateItem(RAFT_ITERATIONS_TABLE, { id }, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
}
