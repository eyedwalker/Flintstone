/**
 * Model Comparison — A/B testing between base and fine-tuned models.
 *
 * Compares two test runs (same suite, different models) and computes:
 *   - Overall score delta
 *   - Per-category deltas
 *   - Win rate (% of cases where challenger scored higher)
 */

import { v4 as uuidv4 } from 'uuid';
import * as ddb from './dynamo';

const TEST_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
const TEST_RESULTS_TABLE = process.env['TEST_RESULTS_TABLE'] ?? '';
const TEST_CASES_TABLE = process.env['TEST_CASES_TABLE'] ?? '';
const RAFT_ITERATIONS_TABLE = process.env['RAFT_ITERATIONS_TABLE'] ?? 'chat-agent-raft-iterations-dev';

interface IModelComparison {
  id: string;
  tenantId: string;
  assistantId: string;
  suiteId: string;
  baseRunId: string;
  challengerRunId: string;
  baseModelId: string;
  challengerModelId: string;
  baseAvgScore: number;
  challengerAvgScore: number;
  scoreDelta: number;
  perCategoryDeltas: Record<string, number>;
  perCaseResults: Array<{
    testCaseId: string;
    testCaseName: string;
    category: string;
    baseScore: number;
    challengerScore: number;
    delta: number;
  }>;
  winRate: number;
  totalCases: number;
  createdAt: string;
}

/**
 * Compare two test runs and generate a detailed comparison report.
 */
export async function compareRuns(
  baseRunId: string,
  challengerRunId: string,
  tenantId: string,
): Promise<IModelComparison> {
  // Load both runs
  const baseRun = await ddb.getItem<any>(TEST_RUNS_TABLE, { id: baseRunId });
  const challengerRun = await ddb.getItem<any>(TEST_RUNS_TABLE, { id: challengerRunId });
  if (!baseRun || !challengerRun) throw new Error('Run not found');

  // Load results for both
  const baseResults = await ddb.queryItems<any>(
    TEST_RESULTS_TABLE, 'runId = :r', { ':r': baseRunId }, undefined, 'runId-index',
  );
  const challengerResults = await ddb.queryItems<any>(
    TEST_RESULTS_TABLE, 'runId = :r', { ':r': challengerRunId }, undefined, 'runId-index',
  );

  // Load test cases for names and categories
  const caseIds = new Set([
    ...baseResults.map((r: any) => r.testCaseId),
    ...challengerResults.map((r: any) => r.testCaseId),
  ]);
  const caseMap = new Map<string, { name: string; category: string }>();
  for (const caseId of caseIds) {
    const tc = await ddb.getItem<any>(TEST_CASES_TABLE, { id: caseId });
    if (tc) caseMap.set(caseId, { name: tc.name, category: tc.category });
  }

  // Index challenger results by testCaseId
  const challengerByCase = new Map<string, any>();
  for (const r of challengerResults) {
    challengerByCase.set(r.testCaseId, r);
  }

  // Compare per-case
  const perCaseResults: IModelComparison['perCaseResults'] = [];
  const categoryScores: Record<string, { baseTotal: number; challTotal: number; count: number }> = {};
  let wins = 0;

  for (const baseResult of baseResults) {
    const challResult = challengerByCase.get(baseResult.testCaseId);
    if (!challResult) continue;

    const baseScore = baseResult.aiEvaluation?.overallScore ?? 0;
    const challScore = challResult.aiEvaluation?.overallScore ?? 0;
    const delta = challScore - baseScore;
    const caseInfo = caseMap.get(baseResult.testCaseId);

    perCaseResults.push({
      testCaseId: baseResult.testCaseId,
      testCaseName: caseInfo?.name ?? 'Unknown',
      category: caseInfo?.category ?? 'unknown',
      baseScore,
      challengerScore: challScore,
      delta,
    });

    if (challScore > baseScore) wins++;

    const cat = caseInfo?.category ?? 'unknown';
    if (!categoryScores[cat]) categoryScores[cat] = { baseTotal: 0, challTotal: 0, count: 0 };
    categoryScores[cat].baseTotal += baseScore;
    categoryScores[cat].challTotal += challScore;
    categoryScores[cat].count++;
  }

  // Compute per-category deltas
  const perCategoryDeltas: Record<string, number> = {};
  for (const [cat, scores] of Object.entries(categoryScores)) {
    const baseAvg = scores.count > 0 ? scores.baseTotal / scores.count : 0;
    const challAvg = scores.count > 0 ? scores.challTotal / scores.count : 0;
    perCategoryDeltas[cat] = Math.round((challAvg - baseAvg) * 10) / 10;
  }

  // Sort per-case by delta (biggest improvements first)
  perCaseResults.sort((a, b) => b.delta - a.delta);

  const comparison: IModelComparison = {
    id: uuidv4(),
    tenantId,
    assistantId: baseRun.assistantId,
    suiteId: baseRun.suiteId,
    baseRunId,
    challengerRunId,
    baseModelId: baseRun.modelId ?? 'base',
    challengerModelId: challengerRun.modelId ?? 'challenger',
    baseAvgScore: baseRun.avgScore ?? 0,
    challengerAvgScore: challengerRun.avgScore ?? 0,
    scoreDelta: Math.round(((challengerRun.avgScore ?? 0) - (baseRun.avgScore ?? 0)) * 10) / 10,
    perCategoryDeltas,
    perCaseResults,
    winRate: perCaseResults.length > 0 ? Math.round((wins / perCaseResults.length) * 100) : 0,
    totalCases: perCaseResults.length,
    createdAt: new Date().toISOString(),
  };

  // Store in the RAFT iterations table as a comparison record
  const comparisonRecord = { ...comparison, id: `comparison-${comparison.id}` };
  await ddb.putItem(RAFT_ITERATIONS_TABLE, comparisonRecord as unknown as Record<string, unknown>);

  return comparison;
}

/**
 * Get a comparison by ID.
 */
export async function getComparison(id: string): Promise<IModelComparison | null> {
  return ddb.getItem<IModelComparison>(RAFT_ITERATIONS_TABLE, { id: `comparison-${id}` });
}
