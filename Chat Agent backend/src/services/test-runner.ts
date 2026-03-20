/**
 * Test Execution Engine
 *
 * Runs test cases against the Bedrock agent and evaluates responses
 * using LLM-as-judge scoring (inspired by DeepEval/RAGAS metrics).
 */
import { v4 as uuidv4 } from 'uuid';
import * as ddb from './dynamo';
import { invokeAgent, invokeModel } from './bedrock-chat';
import { classifyIntent } from '../routes/chat';

const TEST_CASES_TABLE = process.env['TEST_CASES_TABLE'] ?? '';
const TEST_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
const TEST_RESULTS_TABLE = process.env['TEST_RESULTS_TABLE'] ?? '';
const METRICS_TABLE = process.env['METRICS_TABLE'] ?? '';
const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';
const ASSISTANT_KB_TABLE = process.env['ASSISTANT_KB_TABLE'] ?? '';
const KNOWLEDGE_BASES_TABLE = process.env['KNOWLEDGE_BASES_TABLE'] ?? '';

interface ITestCase {
  id: string;
  suiteId: string;
  name: string;
  category: string;
  turns: ITestTurn[];
  roleLevel?: number;
  context?: Record<string, string>;
  enabled: boolean;
}

interface ITestTurn {
  userMessage: string;
  expectedBehavior: string;
  assertions?: IAssertion[];
}

interface IAssertion {
  type: string;
  value: string;
  weight?: number;
}

interface IAssistant {
  id: string;
  tenantId: string;
  bedrockAgentId: string;
  bedrockAgentAliasId: string;
  bedrockKnowledgeBaseId?: string;
}

interface IKbLink { assistantId: string; knowledgeBaseId: string }
interface IKbDef { id: string; bedrockKnowledgeBaseId?: string }

/**
 * Execute a full test run for a suite.
 * Called from the TestRunnerFunction Lambda (15-min timeout).
 */
export async function executeTestRun(
  runId: string,
  suiteId: string,
  assistantId: string,
  tenantId: string,
  offset = 0,
): Promise<void> {
  const startTime = Date.now();

  // Load assistant
  const assistant = await ddb.getItem<IAssistant>(ASSISTANTS_TABLE, { id: assistantId });
  if (!assistant?.bedrockAgentId || !assistant?.bedrockAgentAliasId) {
    await ddb.updateItem(TEST_RUNS_TABLE, { id: runId }, {
      status: 'failed',
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  // Resolve KB IDs for role-based filtering
  const kbIds = await resolveKbIds(assistantId, assistant.bedrockKnowledgeBaseId);

  // Load enabled test cases
  const allCases = await ddb.queryItems<ITestCase>(
    TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
  );
  const enabledCases = allCases.filter(c => c.enabled);

  // Resume from offset if continuing
  const cases = enabledCases.slice(offset);

  // Update run status
  if (offset === 0) {
    await ddb.updateItem(TEST_RUNS_TABLE, { id: runId }, {
      status: 'running',
      totalCases: enabledCases.length,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  let completedCases = offset;
  let passedCases = 0;
  let failedCases = 0;
  let errorCases = 0;
  let scoreSum = 0;

  // If resuming, get existing counts
  if (offset > 0) {
    const run = await ddb.getItem<{ passedCases: number; failedCases: number; errorCases: number }>(TEST_RUNS_TABLE, { id: runId });
    if (run) {
      passedCases = run.passedCases || 0;
      failedCases = run.failedCases || 0;
      errorCases = run.errorCases || 0;
    }
  }

  for (const testCase of cases) {
    // Check if run was cancelled
    const currentRun = await ddb.getItem<{ status: string }>(TEST_RUNS_TABLE, { id: runId });
    if (currentRun?.status === 'cancelled') break;

    // Check time — leave 60s safety margin for self-invocation
    if (Date.now() - startTime > 840_000) {
      // Self-invoke to continue
      const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
      const lambda = new LambdaClient({});
      await lambda.send(new InvokeCommand({
        FunctionName: process.env['TEST_RUNNER_FUNCTION_NAME'] ?? '',
        InvocationType: 'Event', // async
        Payload: Buffer.from(JSON.stringify({
          _testRunContinuation: { runId, suiteId, assistantId, tenantId, offset: completedCases },
        })),
      }));
      return; // Exit — continuation Lambda will pick up
    }

    try {
      const result = await executeTestCase(testCase, assistant, kbIds, tenantId);

      // Evaluate with LLM-as-judge
      const evaluation = await evaluateResult(testCase, result.turns);
      const passed = evaluation.overallScore >= 60;

      await ddb.putItem(TEST_RESULTS_TABLE, {
        id: uuidv4(),
        runId,
        testCaseId: testCase.id,
        tenantId,
        status: passed ? 'passed' : 'failed',
        turns: result.turns,
        aiEvaluation: evaluation,
        durationMs: result.durationMs,
        sessionId: result.sessionId,
        createdAt: new Date().toISOString(),
      });

      // Write metrics record for each turn (simulates real user conversations)
      if (METRICS_TABLE) {
        for (const turn of result.turns) {
          try {
            await ddb.putItem(METRICS_TABLE, {
              id: uuidv4(),
              assistantId,
              tenantId,
              sessionId: result.sessionId,
              query: turn.userMessage,
              responseLength: turn.actualResponse.length,
              latencyMs: turn.latencyMs,
              intent: classifyIntent(result.actionGroupCalls as any),
              guardrailTriggered: false,
              videoCited: /video|vimeo|youtube/i.test(turn.actualResponse),
              satisfied: null,
              source: 'test',
              testRunId: runId,
              testCategory: testCase.category,
              aiScore: evaluation.overallScore,
              createdAt: new Date().toISOString(),
            });
          } catch { /* non-critical */ }
        }
      }

      completedCases++;
      if (passed) passedCases++;
      else failedCases++;
      scoreSum += evaluation.overallScore;
    } catch (e) {
      console.error(`Test case ${testCase.id} error:`, e);

      await ddb.putItem(TEST_RESULTS_TABLE, {
        id: uuidv4(),
        runId,
        testCaseId: testCase.id,
        tenantId,
        status: 'error',
        turns: [],
        aiEvaluation: { overallScore: 0, metrics: {}, reasoning: `Error: ${String(e)}`, issues: [String(e)] },
        durationMs: 0,
        sessionId: '',
        createdAt: new Date().toISOString(),
      });

      completedCases++;
      errorCases++;
    }

    // Update progress
    const avgScore = completedCases > 0 ? Math.round(scoreSum / (completedCases - errorCases || 1)) : 0;
    await ddb.updateItem(TEST_RUNS_TABLE, { id: runId }, {
      completedCases,
      passedCases,
      failedCases,
      errorCases,
      avgScore,
      updatedAt: new Date().toISOString(),
    });

    // Small delay between cases to avoid throttling
    await new Promise(r => setTimeout(r, 200));
  }

  // Recalculate final stats from ALL results (handles multi-continuation runs correctly)
  const allResults = await ddb.queryItems<{ aiEvaluation: { overallScore: number }; status: string }>(
    TEST_RESULTS_TABLE, 'runId = :r', { ':r': runId }, undefined, 'runId-index',
  );
  const scoredResults = allResults.filter(r => r.status !== 'error' && r.aiEvaluation?.overallScore != null);
  const finalAvg = scoredResults.length > 0
    ? Math.round(scoredResults.reduce((sum, r) => sum + r.aiEvaluation.overallScore, 0) / scoredResults.length)
    : 0;

  await ddb.updateItem(TEST_RUNS_TABLE, { id: runId }, {
    status: 'completed',
    completedCases: allResults.length,
    passedCases: allResults.filter(r => r.status === 'passed').length,
    failedCases: allResults.filter(r => r.status === 'failed').length,
    errorCases: allResults.filter(r => r.status === 'error').length,
    avgScore: finalAvg,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function resolveKbIds(assistantId: string, legacyKbId?: string): Promise<string[]> {
  const ids: string[] = [];

  try {
    const links = await ddb.queryItems<IKbLink>(
      ASSISTANT_KB_TABLE, 'assistantId = :a', { ':a': assistantId },
    );
    for (const link of links) {
      const def = await ddb.getItem<IKbDef>(KNOWLEDGE_BASES_TABLE, { id: link.knowledgeBaseId });
      if (def?.bedrockKnowledgeBaseId) ids.push(def.bedrockKnowledgeBaseId);
    }
  } catch { /* ignore */ }

  if (legacyKbId && !ids.includes(legacyKbId)) ids.push(legacyKbId);
  return ids;
}

/**
 * Execute a single test case (all turns).
 */
async function executeTestCase(
  testCase: ITestCase,
  assistant: IAssistant,
  kbIds: string[],
  tenantId: string,
): Promise<{ turns: ITurnResult[]; durationMs: number; sessionId: string; actionGroupCalls?: unknown[] }> {
  const caseStart = Date.now();
  let sessionId = uuidv4();
  const turns: ITurnResult[] = [];
  let allActionGroupCalls: unknown[] = [];

  // Build role filter if needed
  const roleFilter = testCase.roleLevel !== undefined && kbIds.length > 0
    ? (kbIds.length === 1
        ? { kbId: kbIds[0], roleLevel: testCase.roleLevel }
        : { kbIds, roleLevel: testCase.roleLevel })
    : undefined;

  for (const turn of testCase.turns) {
    const turnStart = Date.now();
    let message = turn.userMessage;

    // Prepend context if configured
    if (testCase.context && Object.keys(testCase.context).length > 0) {
      const ctxParts = Object.entries(testCase.context).map(([k, v]) => `${k}: ${v}`);
      message = `[Context: ${ctxParts.join(', ')}]\n${message}`;
    }

    const agentResult = await invokeAgent(
      assistant.bedrockAgentId,
      assistant.bedrockAgentAliasId,
      message,
      sessionId,
      roleFilter as any,
    );
    const reply = agentResult.text;
    if (agentResult.actionGroupCalls) allActionGroupCalls.push(...agentResult.actionGroupCalls);

    const latencyMs = Date.now() - turnStart;

    // Check assertions
    const assertionResults = turn.assertions
      ? evaluateAssertions(reply, turn.assertions)
      : undefined;

    turns.push({
      userMessage: turn.userMessage,
      expectedBehavior: turn.expectedBehavior,
      actualResponse: reply,
      latencyMs,
      turnScore: 0, // Will be set by AI evaluation
      assertionResults,
    });
  }

  return {
    turns,
    durationMs: Date.now() - caseStart,
    sessionId,
    actionGroupCalls: allActionGroupCalls.length > 0 ? allActionGroupCalls : undefined,
  };
}

interface ITurnResult {
  userMessage: string;
  expectedBehavior: string;
  actualResponse: string;
  latencyMs: number;
  turnScore: number;
  assertionResults?: { type: string; passed: boolean; detail: string }[];
}

function evaluateAssertions(
  response: string,
  assertions: IAssertion[],
): { type: string; passed: boolean; detail: string }[] {
  const lower = response.toLowerCase();
  return assertions.map(a => {
    switch (a.type) {
      case 'contains':
        return { type: a.type, passed: lower.includes(a.value.toLowerCase()), detail: `Expected to contain "${a.value}"` };
      case 'not-contains':
        return { type: a.type, passed: !lower.includes(a.value.toLowerCase()), detail: `Expected NOT to contain "${a.value}"` };
      case 'mentions-video':
        return { type: a.type, passed: /video|vimeo|youtube|watch/i.test(response), detail: 'Expected a video reference' };
      case 'length-min':
        return { type: a.type, passed: response.length >= parseInt(a.value, 10), detail: `Expected min length ${a.value}` };
      case 'length-max':
        return { type: a.type, passed: response.length <= parseInt(a.value, 10), detail: `Expected max length ${a.value}` };
      default:
        return { type: a.type, passed: true, detail: 'Skipped (evaluated by AI)' };
    }
  });
}

/**
 * LLM-as-Judge evaluation of a test result.
 * Scores across 5 RAG-specific metrics inspired by DeepEval/RAGAS.
 */
async function evaluateResult(
  testCase: ITestCase,
  turns: ITurnResult[],
): Promise<{
  overallScore: number;
  metrics: Record<string, number>;
  reasoning: string;
  issues: string[];
}> {
  const conversationText = turns.map((t, i) =>
    `Turn ${i + 1}:\nUser: ${t.userMessage}\nExpected: ${t.expectedBehavior}\nActual: ${t.actualResponse}`
  ).join('\n\n');

  const assertionSummary = turns.flatMap(t =>
    (t.assertionResults || []).filter(a => !a.passed).map(a => `FAILED: ${a.detail}`)
  ).join('\n');

  const prompt = `Evaluate this AI chatbot test result. Score each metric 0-100.

Test: "${testCase.name}" (category: ${testCase.category})

${conversationText}

${assertionSummary ? `\nFailed assertions:\n${assertionSummary}` : ''}

Score these metrics:
- relevance: Does the response directly address the user's question?
- accuracy: Is the information factually correct (not hallucinated)?
- completeness: Is the answer thorough enough?
- tone: Is the response professional and appropriately styled?
- guardrailCompliance: Does the response stay within appropriate boundaries?

Also provide:
- overallScore: Weighted average (relevance 30%, accuracy 30%, completeness 20%, tone 10%, guardrail 10%)
- reasoning: 2-3 sentence explanation
- issues: Array of specific problems found (empty array if none)

Return ONLY valid JSON: { "overallScore": N, "metrics": { "relevance": N, "accuracy": N, "completeness": N, "tone": N, "guardrailCompliance": N }, "reasoning": "...", "issues": [...] }`;

  try {
    const response = await invokeModel(
      'You are an expert QA evaluator. Respond only with valid JSON.',
      prompt,
    );

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      overallScore: parsed.overallScore ?? 50,
      metrics: parsed.metrics ?? {},
      reasoning: parsed.reasoning ?? '',
      issues: parsed.issues ?? [],
    };
  } catch (e) {
    console.error('Evaluation parse error:', e);
    return {
      overallScore: 50,
      metrics: { relevance: 50, accuracy: 50, completeness: 50, tone: 50, guardrailCompliance: 50 },
      reasoning: 'Evaluation failed — using default scores',
      issues: ['AI evaluation could not parse response'],
    };
  }
}
