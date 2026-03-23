import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import * as ameliaClient from '../services/amelia-client';
import { ok, badRequest, notFound, serverError, noContent } from '../response';
import { IRequestContext, requireRole } from '../auth';

const TEST_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
const TEST_RESULTS_TABLE = process.env['TEST_RESULTS_TABLE'] ?? '';
const TEST_CASES_TABLE = process.env['TEST_CASES_TABLE'] ?? '';
const TEST_SUITES_TABLE = process.env['TEST_SUITES_TABLE'] ?? '';
const TENANTS_TABLE = process.env['TENANTS_TABLE'] ?? '';

interface IAmeliaConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  domainCode?: string;
}

/**
 * External bot testing routes.
 * Runs test suites against external chatbots (e.g. Amelia) via REST API
 * and stores results alongside the normal test run infrastructure.
 *
 * Routes:
 *   POST /external-bot/test              — run a quick ad-hoc test (few questions)
 *   POST /external-bot/run/:suiteId      — run a full test suite against external bot
 *   GET  /external-bot/config            — get saved Amelia config for this tenant
 *   PUT  /external-bot/config            — save Amelia connection config
 */
export async function handleExternalBot(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  ctx: IRequestContext,
): Promise<APIGatewayProxyResultV2> {
  const tenantId = ctx.organizationId;

  try {
    if (!requireRole(ctx, 'admin')) {
      return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Admin role required' }) };
    }

    // ── GET /external-bot/config — get saved Amelia config ────────────────
    if (method === 'GET' && path.endsWith('/config')) {
      const tenant = await ddb.getItem<Record<string, unknown>>(TENANTS_TABLE, { id: tenantId });
      const config = tenant?.['externalBotConfig'] as IAmeliaConfig | undefined;
      return ok(config ?? { baseUrl: 'https://eyefinity.partners.amelia.com/AmeliaRest', domainCode: 'eyefinitysandbox' });
    }

    // ── PUT /external-bot/config — save Amelia config ─────────────────────
    if (method === 'PUT' && path.endsWith('/config')) {
      const config: IAmeliaConfig = {
        baseUrl: (body['baseUrl'] as string) || 'https://eyefinity.partners.amelia.com/AmeliaRest',
        username: body['username'] as string | undefined,
        password: body['password'] as string | undefined,
        clientId: body['clientId'] as string | undefined,
        clientSecret: body['clientSecret'] as string | undefined,
        domainCode: body['domainCode'] as string | undefined,
      };

      await ddb.updateItem(TENANTS_TABLE, { id: tenantId }, {
        externalBotConfig: config,
        updatedAt: new Date().toISOString(),
      });
      return ok({ success: true });
    }

    // ── POST /external-bot/test — quick ad-hoc test (async) ────────────────
    if (method === 'POST' && path.endsWith('/test')) {
      const questions = body['questions'] as string[];
      if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return badRequest('questions array required');
      }

      const config = await getAmeliaConfig(tenantId, body);
      const jobId = uuidv4();
      const limited = questions.slice(0, 10);

      // Store job as pending
      await ddb.putItem(TEST_RUNS_TABLE, {
        id: jobId,
        tenantId,
        suiteId: '_quicktest',
        assistantId: '_quicktest',
        status: 'running',
        totalCases: limited.length,
        completedCases: 0,
        passedCases: 0,
        failedCases: 0,
        errorCases: 0,
        avgScore: 0,
        externalBot: 'amelia',
        quickTestQuestions: limited,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Async invoke TestRunnerFunction (15-min timeout)
      const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
      const lambdaClient = new LambdaClient({});
      const payload = JSON.stringify({
        _externalBotQuickTest: { jobId, tenantId, questions: limited, config },
      });
      console.log(`[ExternalBot] Invoking test runner: ${process.env['TEST_RUNNER_FUNCTION_NAME']}, jobId=${jobId}`);
      try {
        const invokeResult = await lambdaClient.send(new InvokeCommand({
          FunctionName: process.env['TEST_RUNNER_FUNCTION_NAME'] || '',
          InvocationType: 'Event',
          Payload: new TextEncoder().encode(payload),
        }));
        console.log(`[ExternalBot] Invoke result: ${invokeResult.StatusCode}`);
      } catch (invokeErr) {
        console.error(`[ExternalBot] Invoke failed:`, invokeErr);
        await ddb.updateItem(TEST_RUNS_TABLE, { id: jobId }, { status: 'failed', quickTestError: String(invokeErr) });
        return badRequest(`Failed to start test: ${String(invokeErr).slice(0, 200)}`);
      }

      return ok({ jobId, status: 'running', totalQuestions: limited.length });
    }

    // ── GET /external-bot/test/:jobId — poll for quick test result ────────
    const testPollMatch = path.match(/\/external-bot\/test\/([^/]+)/);
    if (method === 'GET' && testPollMatch) {
      const jobId = testPollMatch[1];
      const job = await ddb.getItem<Record<string, unknown>>(TEST_RUNS_TABLE, { id: jobId });
      if (!job || job['tenantId'] !== tenantId) return notFound();
      return ok(job);
    }

    // ── POST /external-bot/run/:suiteId — run full suite against Amelia ───
    const runMatch = path.match(/\/external-bot\/run\/([^/]+)/);
    if (method === 'POST' && runMatch) {
      const suiteId = runMatch[1];

      const suite = await ddb.getItem<{ id: string; assistantId: string; tenantId: string; testCaseCount: number }>(
        TEST_SUITES_TABLE, { id: suiteId },
      );
      if (!suite || suite.tenantId !== tenantId) return notFound('Suite not found');

      // Load enabled cases
      const allCases = await ddb.queryItems<{
        id: string; enabled: boolean; turns: Array<{ userMessage: string; expectedBehavior?: string }>;
        name: string; category: string;
      }>(TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index');
      const enabledCases = allCases.filter(c => c.enabled);
      if (enabledCases.length === 0) return badRequest('No enabled test cases');

      // Create run record — mark it as an external bot run
      const runId = uuidv4();
      await ddb.putItem(TEST_RUNS_TABLE, {
        id: runId,
        suiteId,
        assistantId: suite.assistantId,
        tenantId,
        status: 'queued',
        totalCases: enabledCases.length,
        completedCases: 0,
        passedCases: 0,
        failedCases: 0,
        errorCases: 0,
        avgScore: 0,
        externalBot: 'amelia',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Update suite
      await ddb.updateItem(TEST_SUITES_TABLE, { id: suiteId }, {
        lastRunId: runId,
        lastRunAt: new Date().toISOString(),
        lastRunStatus: 'running',
        updatedAt: new Date().toISOString(),
      });

      // Async invoke TestRunnerFunction for the heavy work
      const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
      const lambdaClient = new LambdaClient({});
      await lambdaClient.send(new InvokeCommand({
        FunctionName: process.env['TEST_RUNNER_FUNCTION_NAME'] || '',
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          _externalBotRun: {
            runId,
            suiteId,
            assistantId: suite.assistantId,
            tenantId,
          },
        })),
      }));

      return ok({ runId, totalCases: enabledCases.length, status: 'queued', externalBot: 'amelia' });
    }

    return notFound();
  } catch (e) {
    console.error('external-bot handler error', e);
    const msg = String(e);
    // Surface auth errors to the user so they can fix credentials
    if (msg.includes('authenticate') || msg.includes('login') || msg.includes('credentials')) {
      return badRequest(`Amelia connection failed: ${msg.replace(/^Error:\s*/, '')}`);
    }
    return serverError(msg);
  }
}

/**
 * Execute a full external bot test run.
 * Called from TestRunnerFunction Lambda (15-min timeout).
 */
export async function executeExternalBotRun(
  runId: string,
  suiteId: string,
  assistantId: string,
  tenantId: string,
): Promise<void> {
  const config = await getAmeliaConfig(tenantId);

  // Load enabled cases
  const allCases = await ddb.queryItems<{
    id: string; enabled: boolean; name: string; category: string;
    turns: Array<{ userMessage: string; expectedBehavior?: string; assertions?: unknown[] }>;
  }>(TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index');
  const enabledCases = allCases.filter(c => c.enabled);

  // Update run status
  await ddb.updateItem(TEST_RUNS_TABLE, { id: runId }, {
    status: 'running',
    totalCases: enabledCases.length,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Authenticate and create conversation
  let auth: { token: string; authMode: 'token' | 'bearer' };
  let session: ameliaClient.IAmeliaSession;

  try {
    auth = await ameliaClient.authenticate(config);
    session = await ameliaClient.createConversation(auth, config);

    // Get welcome message
    await ameliaClient.pollResponse(session, true, 3);
  } catch (e) {
    console.error('Amelia connection failed:', e);
    await ddb.updateItem(TEST_RUNS_TABLE, { id: runId }, {
      status: 'failed',
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  let completedCases = 0;
  let passedCases = 0;
  let failedCases = 0;
  let errorCases = 0;
  let scoreSum = 0;

  for (const testCase of enabledCases) {
    // Check if cancelled
    const currentRun = await ddb.getItem<{ status: string }>(TEST_RUNS_TABLE, { id: runId });
    if (currentRun?.status === 'cancelled') break;

    try {
      const caseStart = Date.now();
      const turnResults: Array<{
        userMessage: string;
        expectedBehavior: string;
        actualResponse: string;
        latencyMs: number;
        turnScore: number;
      }> = [];

      for (const turn of testCase.turns) {
        const turnStart = Date.now();

        try {
          const response = await ameliaClient.chat(session, turn.userMessage);
          turnResults.push({
            userMessage: turn.userMessage,
            expectedBehavior: turn.expectedBehavior ?? '',
            actualResponse: response.text,
            latencyMs: response.responseTimeMs,
            turnScore: 0,
          });
        } catch (turnErr) {
          turnResults.push({
            userMessage: turn.userMessage,
            expectedBehavior: turn.expectedBehavior ?? '',
            actualResponse: `Error: ${String(turnErr)}`,
            latencyMs: Date.now() - turnStart,
            turnScore: 0,
          });
        }
      }

      // Evaluate with LLM-as-judge
      const evaluation = await evaluateExternalBotResult(testCase, turnResults);
      const passed = evaluation.overallScore >= 60;

      await ddb.putItem(TEST_RESULTS_TABLE, {
        id: uuidv4(),
        runId,
        testCaseId: testCase.id,
        tenantId,
        status: passed ? 'passed' : 'failed',
        turns: turnResults,
        aiEvaluation: evaluation,
        durationMs: Date.now() - caseStart,
        sessionId: session.conversationId,
        externalBot: 'amelia',
        createdAt: new Date().toISOString(),
      });

      completedCases++;
      if (passed) passedCases++;
      else failedCases++;
      scoreSum += evaluation.overallScore;
    } catch (e) {
      console.error(`External bot test case ${testCase.id} error:`, e);

      await ddb.putItem(TEST_RESULTS_TABLE, {
        id: uuidv4(),
        runId,
        testCaseId: testCase.id,
        tenantId,
        status: 'error',
        turns: [],
        aiEvaluation: { overallScore: 0, metrics: {}, reasoning: `Error: ${String(e)}`, issues: [String(e)] },
        durationMs: 0,
        sessionId: session.conversationId,
        externalBot: 'amelia',
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

    // Delay between questions to avoid rate limiting
    await new Promise(r => setTimeout(r, 1500));
  }

  // Close Amelia conversation
  await ameliaClient.closeConversation(session);

  // Final stats
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

  // Update suite
  await ddb.updateItem(TEST_SUITES_TABLE, { id: suiteId }, {
    lastRunStatus: 'completed',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Execute a quick ad-hoc test against Amelia.
 * Called from TestRunnerFunction Lambda (15-min timeout).
 */
export async function executeExternalBotQuickTest(
  jobId: string,
  tenantId: string,
  questions: string[],
  config: ameliaClient.IAmeliaConfig,
): Promise<void> {
  const results = await runAmeliaQuestions(config, questions);

  await ddb.updateItem(TEST_RUNS_TABLE, { id: jobId }, {
    status: 'completed',
    completedCases: results.length,
    quickTestResults: results,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

async function getAmeliaConfig(
  tenantId: string,
  overrides?: Record<string, unknown>,
): Promise<ameliaClient.IAmeliaConfig> {
  // Load saved config from tenant
  const tenant = await ddb.getItem<Record<string, unknown>>(TENANTS_TABLE, { id: tenantId });
  const saved = (tenant?.['externalBotConfig'] ?? {}) as Record<string, string>;

  return {
    baseUrl: (overrides?.['baseUrl'] as string) ?? saved['baseUrl'] ?? 'https://eyefinity.partners.amelia.com/AmeliaRest',
    username: (overrides?.['username'] as string) ?? saved['username'],
    password: (overrides?.['password'] as string) ?? saved['password'],
    clientId: (overrides?.['clientId'] as string) ?? saved['clientId'],
    clientSecret: (overrides?.['clientSecret'] as string) ?? saved['clientSecret'],
    domainCode: (overrides?.['domainCode'] as string) ?? saved['domainCode'] ?? 'eyefinitysandbox',
  };
}

async function runAmeliaQuestions(
  config: ameliaClient.IAmeliaConfig,
  questions: string[],
): Promise<Array<{ question: string; response: string; responseTimeMs: number; error?: string }>> {
  const auth = await ameliaClient.authenticate(config);
  const session = await ameliaClient.createConversation(auth, config);

  // Get welcome message
  await ameliaClient.pollResponse(session, true, 3);

  const results: Array<{ question: string; response: string; responseTimeMs: number; error?: string }> = [];

  for (const question of questions) {
    try {
      const response = await ameliaClient.chat(session, question);
      results.push({
        question,
        response: response.text,
        responseTimeMs: response.responseTimeMs,
      });
    } catch (err) {
      results.push({
        question,
        response: '',
        responseTimeMs: 0,
        error: String(err),
      });
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  await ameliaClient.closeConversation(session);
  return results;
}

async function evaluateExternalBotResult(
  testCase: { name: string; category: string },
  turns: Array<{ userMessage: string; expectedBehavior: string; actualResponse: string }>,
): Promise<{
  overallScore: number;
  metrics: Record<string, number>;
  reasoning: string;
  issues: string[];
}> {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region: process.env['AWS_REGION'] ?? 'us-west-2' });

  const conversationText = turns.map((t, i) =>
    `Turn ${i + 1}:\nUser: ${t.userMessage}\n${t.expectedBehavior ? `Expected: ${t.expectedBehavior}\n` : ''}Actual: ${t.actualResponse}`
  ).join('\n\n');

  const prompt = `Evaluate this external AI chatbot (Amelia) test result. Score each metric 0-100.

Test: "${testCase.name}" (category: ${testCase.category})

${conversationText}

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
    const res = await client.send(new InvokeModelCommand({
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    }));

    const parsed = JSON.parse(new TextDecoder().decode(res.body));
    const text = parsed.content?.[0]?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in eval response');
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('External bot evaluation error:', e);
    return {
      overallScore: 50,
      metrics: { relevance: 50, accuracy: 50, completeness: 50, tone: 50, guardrailCompliance: 50 },
      reasoning: 'Evaluation failed — using default scores',
      issues: ['AI evaluation could not parse response'],
    };
  }
}
