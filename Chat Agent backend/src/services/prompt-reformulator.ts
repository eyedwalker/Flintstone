/**
 * Prompt Reformulator — generates new/rephrased test prompts for RAFT re-testing.
 *
 * Prevents memorization by:
 *   1. Rephrasing existing prompts (20-30%) — same intent, different wording
 *   2. Generating new prompts (10%) — targeting weak categories from previous run
 *
 * Uses Claude Haiku for fast reformulation (~200ms per batch).
 */

import { v4 as uuidv4 } from 'uuid';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as ddb from './dynamo';

const REGION = process.env['REGION'] ?? 'us-west-2';
const TEST_CASES_TABLE = process.env['TEST_CASES_TABLE'] ?? '';
const TEST_RESULTS_TABLE = process.env['TEST_RESULTS_TABLE'] ?? '';
const HAIKU_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

const bedrock = new BedrockRuntimeClient({ region: REGION });

interface ITestCase {
  id: string;
  suiteId: string;
  tenantId: string;
  name: string;
  category: string;
  source: string;
  sourceContentId?: string;
  priority: string;
  turns: Array<{ userMessage: string; expectedBehavior: string; assertions?: unknown[] }>;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ITestResult {
  testCaseId: string;
  aiEvaluation: { overallScore: number };
  turns: Array<{ userMessage: string }>;
}

/**
 * Reformulate test prompts for the next RAFT cycle.
 *
 * @param suiteId - The test suite to reformulate
 * @param tenantId - Tenant ID
 * @param previousRunId - The run to analyze for weak areas
 * @param reformulationPct - Percentage of prompts to reformulate (0.2-0.4)
 * @returns Count of reformulated and new cases
 */
export async function reformulateTestCases(
  suiteId: string,
  tenantId: string,
  previousRunId: string,
  reformulationPct: number = 0.3,
): Promise<{ reformulated: number; newCases: number; total: number }> {
  // Load existing cases
  const cases = await ddb.queryItems<ITestCase>(
    TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
  );
  const enabledCases = cases.filter(c => c.enabled);

  if (enabledCases.length === 0) {
    return { reformulated: 0, newCases: 0, total: 0 };
  }

  // Load previous run results to find weak categories
  const results = await ddb.queryItems<ITestResult>(
    TEST_RESULTS_TABLE, 'runId = :r', { ':r': previousRunId }, undefined, 'runId-index',
  );

  const weakCategories = findWeakCategories(enabledCases, results);
  console.log(`[Reformulator] Weak categories:`, weakCategories);

  // Select cases for reformulation (random subset)
  const reformCount = Math.min(
    Math.ceil(enabledCases.length * reformulationPct),
    enabledCases.length,
  );
  const shuffled = [...enabledCases].sort(() => Math.random() - 0.5);

  // Prioritize weak-category cases for reformulation
  const weakCases = shuffled.filter(c => weakCategories.includes(c.category));
  const otherCases = shuffled.filter(c => !weakCategories.includes(c.category));
  const toReformulate = [...weakCases, ...otherCases].slice(0, reformCount);

  // Reformulate in batches of 5
  let reformulated = 0;
  for (let i = 0; i < toReformulate.length; i += 5) {
    const batch = toReformulate.slice(i, i + 5);
    const reformulatedCases = await reformulateBatch(batch, suiteId, tenantId);

    for (const newCase of reformulatedCases) {
      await ddb.putItem(TEST_CASES_TABLE, newCase as unknown as Record<string, unknown>);
      reformulated++;
    }

    // Rate limit
    if (i + 5 < toReformulate.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Generate new cases for weak categories (10% of total)
  const newCount = Math.ceil(enabledCases.length * 0.1);
  let newCases = 0;
  if (weakCategories.length > 0 && newCount > 0) {
    const generated = await generateNewCases(weakCategories, suiteId, tenantId, newCount);
    for (const newCase of generated) {
      await ddb.putItem(TEST_CASES_TABLE, newCase as unknown as Record<string, unknown>);
      newCases++;
    }
  }

  // Update suite test case count
  const totalCases = await ddb.queryItems<ITestCase>(
    TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
  );
  const SUITES_TABLE = process.env['TEST_SUITES_TABLE'] ?? '';
  await ddb.updateItem(SUITES_TABLE, { id: suiteId }, {
    testCaseCount: totalCases.length,
    updatedAt: new Date().toISOString(),
  });

  console.log(`[Reformulator] Done: ${reformulated} reformulated, ${newCases} new`);
  return { reformulated, newCases, total: reformulated + newCases };
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

function findWeakCategories(
  cases: ITestCase[],
  results: ITestResult[],
): string[] {
  // Map testCaseId to category
  const caseMap = new Map(cases.map(c => [c.id, c.category]));

  // Compute avg score per category
  const categoryScores: Record<string, { total: number; count: number }> = {};
  for (const r of results) {
    const cat = caseMap.get(r.testCaseId);
    if (!cat) continue;
    if (!categoryScores[cat]) categoryScores[cat] = { total: 0, count: 0 };
    categoryScores[cat].total += r.aiEvaluation?.overallScore ?? 0;
    categoryScores[cat].count++;
  }

  // Find categories scoring below 70
  const weak: string[] = [];
  for (const [cat, { total, count }] of Object.entries(categoryScores)) {
    const avg = count > 0 ? total / count : 0;
    if (avg < 70) weak.push(cat);
  }

  return weak;
}

async function reformulateBatch(
  cases: ITestCase[],
  suiteId: string,
  tenantId: string,
): Promise<ITestCase[]> {
  const prompts = cases.map((c, i) => `${i + 1}. "${c.turns[0]?.userMessage ?? ''}"`).join('\n');

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    system: `You are a test case reformulator. Rephrase each user question while preserving the exact same semantic intent. Use different words, sentence structure, or phrasing. Output ONLY a JSON array of strings — one rephrased question per input.`,
    messages: [{ role: 'user', content: `Rephrase each question:\n${prompts}\n\nReturn JSON array of rephrased strings:` }],
    max_tokens: 1000,
    temperature: 0.8,
  };

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: HAIKU_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    }));

    const response = JSON.parse(new TextDecoder().decode(res.body));
    const text = response.content?.[0]?.text ?? '[]';

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const rephrased: string[] = JSON.parse(jsonMatch[0]);

    return cases.map((original, i) => {
      const newMessage = rephrased[i] ?? original.turns[0]?.userMessage;
      const now = new Date().toISOString();
      return {
        id: uuidv4(),
        suiteId,
        tenantId,
        name: `[Reformulated] ${original.name}`,
        category: original.category,
        source: 'ai-generated' as const,
        sourceContentId: original.id, // Link to original
        priority: original.priority,
        turns: original.turns.map((t, ti) => ({
          ...t,
          userMessage: ti === 0 ? newMessage : t.userMessage,
        })),
        tags: [...original.tags, 'reformulated'],
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
    }).filter((_, i) => rephrased[i]); // Only include if we got a valid rephrasing
  } catch (err) {
    console.error('[Reformulator] Batch reformulation failed:', err);
    return [];
  }
}

async function generateNewCases(
  categories: string[],
  suiteId: string,
  tenantId: string,
  count: number,
): Promise<ITestCase[]> {
  const categoryList = categories.join(', ');

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    system: `You generate test cases for an AI assistant at an eye care practice. Generate diverse questions a user might ask. Output JSON array of objects with: {name, category, userMessage, expectedBehavior}.`,
    messages: [{
      role: 'user',
      content: `Generate ${count} test cases for these weak categories: ${categoryList}.\n\nThe assistant helps with eye care practice management — appointments, patients, insurance, billing, Encompass software.\n\nReturn JSON array:`,
    }],
    max_tokens: 2000,
    temperature: 0.9,
  };

  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: HAIKU_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    }));

    const response = JSON.parse(new TextDecoder().decode(res.body));
    const text = response.content?.[0]?.text ?? '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const generated: Array<{ name: string; category: string; userMessage: string; expectedBehavior: string }> = JSON.parse(jsonMatch[0]);
    const now = new Date().toISOString();

    return generated.map(g => ({
      id: uuidv4(),
      suiteId,
      tenantId,
      name: g.name || 'New test case',
      category: categories.includes(g.category) ? g.category : categories[0],
      source: 'ai-generated' as const,
      priority: 'medium' as const,
      turns: [{ userMessage: g.userMessage, expectedBehavior: g.expectedBehavior }],
      tags: ['raft-generated'],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }));
  } catch (err) {
    console.error('[Reformulator] New case generation failed:', err);
    return [];
  }
}
