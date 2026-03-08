import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import { ok, badRequest, notFound, serverError, noContent } from '../response';
import { IRequestContext, requireRole } from '../auth';

const TEST_SUITES_TABLE = process.env['TEST_SUITES_TABLE'] ?? '';
const TEST_CASES_TABLE = process.env['TEST_CASES_TABLE'] ?? '';
const TEST_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
const TEST_RESULTS_TABLE = process.env['TEST_RESULTS_TABLE'] ?? '';

interface ITestSuite {
  id: string;
  tenantId: string;
  assistantId: string;
  name: string;
  description: string;
  categories: string[];
  testCaseCount: number;
  lastRunAt?: string;
  lastRunStatus?: string;
  createdAt: string;
  updatedAt: string;
}

interface ITestCase {
  id: string;
  suiteId: string;
  tenantId: string;
  name: string;
  category: string;
  source: string;
  sourceContentId?: string;
  priority: string;
  turns: unknown[];
  roleLevel?: number;
  context?: Record<string, string>;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ITestRun {
  id: string;
  suiteId: string;
  assistantId: string;
  tenantId: string;
  status: string;
  totalCases: number;
  completedCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  avgScore: number;
  improvements?: unknown[];
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ITestResult {
  id: string;
  runId: string;
  testCaseId: string;
  tenantId: string;
  status: string;
  turns: unknown[];
  aiEvaluation: unknown;
  userReview?: unknown;
  durationMs: number;
  sessionId: string;
  createdAt: string;
}

/**
 * CRUD for test suites + cases.
 * Also handles generating test cases via AI.
 */
export async function handleTestSuites(
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

    const id = params['id'];

    // ── Suite CRUD ──────────────────────────────────────────────────

    // POST /test-suites — create suite
    if (method === 'POST' && !path.includes('/cases') && !path.includes('/generate') && !path.includes('/import') && !path.includes('/run')) {
      const assistantId = body['assistantId'] as string;
      if (!assistantId) return badRequest('assistantId required');

      const suite: ITestSuite = {
        id: uuidv4(),
        tenantId,
        assistantId,
        name: (body['name'] as string) || 'New Test Suite',
        description: (body['description'] as string) || '',
        categories: (body['categories'] as string[]) || [],
        testCaseCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await ddb.putItem(TEST_SUITES_TABLE, suite as unknown as Record<string, unknown>);
      return ok(suite);
    }

    // GET /test-suites?assistantId=xxx
    if (method === 'GET' && !id) {
      const assistantId = query['assistantId'];
      if (!assistantId) return badRequest('assistantId query param required');
      const items = await ddb.queryItems<ITestSuite>(
        TEST_SUITES_TABLE, '#a = :a', { ':a': assistantId },
        { '#a': 'assistantId' }, 'assistantId-index',
      );
      return ok(items);
    }

    // GET /test-suites/:id
    if (method === 'GET' && id && !path.includes('/cases')) {
      const suite = await ddb.getItem<ITestSuite>(TEST_SUITES_TABLE, { id });
      if (!suite || suite.tenantId !== tenantId) return notFound();
      return ok(suite);
    }

    // PUT /test-suites/:id
    if (method === 'PUT' && id && !path.includes('/cases')) {
      const suite = await ddb.getItem<ITestSuite>(TEST_SUITES_TABLE, { id });
      if (!suite || suite.tenantId !== tenantId) return notFound();

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (body['name'] !== undefined) updates['name'] = body['name'];
      if (body['description'] !== undefined) updates['description'] = body['description'];
      if (body['categories'] !== undefined) updates['categories'] = body['categories'];
      await ddb.updateItem(TEST_SUITES_TABLE, { id }, updates);
      return ok({ ...suite, ...updates });
    }

    // DELETE /test-suites/:id
    if (method === 'DELETE' && id && !path.includes('/cases')) {
      const suite = await ddb.getItem<ITestSuite>(TEST_SUITES_TABLE, { id });
      if (!suite || suite.tenantId !== tenantId) return notFound();

      // Delete all cases in this suite
      const cases = await ddb.queryItems<ITestCase>(
        TEST_CASES_TABLE, 'suiteId = :s', { ':s': id }, undefined, 'suiteId-index',
      );
      for (const c of cases) {
        await ddb.deleteItem(TEST_CASES_TABLE, { id: c.id });
      }
      await ddb.deleteItem(TEST_SUITES_TABLE, { id });
      return noContent();
    }

    // ── Case CRUD ──────────────────────────────────────────────────

    // Extract suiteId from path like /test-suites/:suiteId/cases/...
    const suiteIdMatch = path.match(/\/test-suites\/([^/]+)\//);
    const suiteId = suiteIdMatch?.[1];

    // GET /test-suites/:suiteId/latest-run — find most recent run for this suite
    if (method === 'GET' && suiteId && path.endsWith('/latest-run')) {
      const runs = await ddb.queryItems<ITestRun>(
        TEST_RUNS_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
      );
      if (!runs.length) return ok(null);
      // Sort by createdAt descending, return the latest
      runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return ok(runs[0]);
    }

    // GET /test-suites/:suiteId/cases
    if (method === 'GET' && suiteId && path.includes('/cases')) {
      const cases = await ddb.queryItems<ITestCase>(
        TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
      );
      return ok(cases);
    }

    // POST /test-suites/:suiteId/cases — create single case
    if (method === 'POST' && suiteId && path.endsWith('/cases')) {
      const testCase: ITestCase = {
        id: uuidv4(),
        suiteId,
        tenantId,
        name: (body['name'] as string) || 'New Test Case',
        category: (body['category'] as string) || 'factual',
        source: 'user-created',
        priority: (body['priority'] as string) || 'medium',
        turns: (body['turns'] as unknown[]) || [{ userMessage: '', expectedBehavior: '' }],
        roleLevel: body['roleLevel'] as number | undefined,
        context: body['context'] as Record<string, string> | undefined,
        tags: (body['tags'] as string[]) || [],
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await ddb.putItem(TEST_CASES_TABLE, testCase as unknown as Record<string, unknown>);

      // Update suite case count
      const cases = await ddb.queryItems<ITestCase>(
        TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
      );
      await ddb.updateItem(TEST_SUITES_TABLE, { id: suiteId }, {
        testCaseCount: cases.length,
        updatedAt: new Date().toISOString(),
      });

      return ok(testCase);
    }

    // PUT /test-suites/:suiteId/cases/:caseId
    if (method === 'PUT' && suiteId && path.includes('/cases/')) {
      const caseId = path.split('/cases/')[1]?.split('/')[0];
      if (!caseId) return badRequest('caseId required');
      const tc = await ddb.getItem<ITestCase>(TEST_CASES_TABLE, { id: caseId });
      if (!tc || tc.tenantId !== tenantId) return notFound();

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const field of ['name', 'category', 'priority', 'turns', 'roleLevel', 'context', 'tags', 'enabled']) {
        if (body[field] !== undefined) updates[field] = body[field];
      }
      await ddb.updateItem(TEST_CASES_TABLE, { id: caseId }, updates);
      return ok({ ...tc, ...updates });
    }

    // DELETE /test-suites/:suiteId/cases/:caseId
    if (method === 'DELETE' && suiteId && path.includes('/cases/')) {
      const caseId = path.split('/cases/')[1]?.split('/')[0];
      if (!caseId) return badRequest('caseId required');
      const tc = await ddb.getItem<ITestCase>(TEST_CASES_TABLE, { id: caseId });
      if (!tc || tc.tenantId !== tenantId) return notFound();

      await ddb.deleteItem(TEST_CASES_TABLE, { id: caseId });
      const remaining = await ddb.queryItems<ITestCase>(
        TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
      );
      await ddb.updateItem(TEST_SUITES_TABLE, { id: suiteId }, {
        testCaseCount: remaining.length,
        updatedAt: new Date().toISOString(),
      });
      return noContent();
    }

    // POST /test-suites/:suiteId/generate — AI generate test cases
    // Routes to TestRunnerFunction (15-min timeout) via async self-invoke
    // because scanning full KB + AI generation can take several minutes.
    if (method === 'POST' && suiteId && path.endsWith('/generate')) {
      const suite = await ddb.getItem<ITestSuite>(TEST_SUITES_TABLE, { id: suiteId });
      if (!suite || suite.tenantId !== tenantId) return notFound();

      const count = (body['count'] as number) || 100;
      const categories = (body['categories'] as string[]) || [];

      // Async invoke TestRunnerFunction for the heavy work
      const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
      const lambdaClient = new LambdaClient({});
      await lambdaClient.send(new InvokeCommand({
        FunctionName: process.env['TEST_RUNNER_FUNCTION_NAME'] || '',
        InvocationType: 'Event', // async
        Payload: Buffer.from(JSON.stringify({
          _testGeneration: {
            suiteId,
            assistantId: suite.assistantId,
            tenantId,
            count,
            categories,
          },
        })),
      }));

      return ok({ status: 'generating', message: `Generating ~${count} test cases in background. Refresh to see progress.` });
    }

    // POST /test-suites/:suiteId/import — bulk import cases
    if (method === 'POST' && suiteId && path.endsWith('/import')) {
      const cases = body['cases'] as unknown[];
      if (!Array.isArray(cases) || cases.length === 0) return badRequest('cases array required');

      let imported = 0;
      for (const c of cases) {
        const caseData = c as Record<string, unknown>;
        const tc: ITestCase = {
          id: uuidv4(),
          suiteId,
          tenantId,
          name: (caseData['name'] as string) || 'Imported Case',
          category: (caseData['category'] as string) || 'factual',
          source: 'imported',
          priority: (caseData['priority'] as string) || 'medium',
          turns: (caseData['turns'] as unknown[]) || [],
          roleLevel: caseData['roleLevel'] as number | undefined,
          tags: (caseData['tags'] as string[]) || [],
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await ddb.putItem(TEST_CASES_TABLE, tc as unknown as Record<string, unknown>);
        imported++;
      }

      const allCases = await ddb.queryItems<ITestCase>(
        TEST_CASES_TABLE, 'suiteId = :s', { ':s': suiteId }, undefined, 'suiteId-index',
      );
      await ddb.updateItem(TEST_SUITES_TABLE, { id: suiteId }, {
        testCaseCount: allCases.length,
        updatedAt: new Date().toISOString(),
      });

      return ok({ imported });
    }

    return notFound();
  } catch (e) {
    console.error('test-suites handler error', e);
    return serverError(String(e));
  }
}

/**
 * Handles /test-runs/* routes (read-only + review + analyze).
 * The actual test execution is in testRunnerHandler (separate Lambda).
 */
export async function handleTestRuns(
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

    const id = params['id'];

    // GET /test-runs/:runId
    if (method === 'GET' && id && !path.includes('/results') && !path.includes('/improvements')) {
      const run = await ddb.getItem<ITestRun>(TEST_RUNS_TABLE, { id });
      if (!run || run.tenantId !== tenantId) return notFound();
      return ok(run);
    }

    // GET /test-runs/:runId/results
    if (method === 'GET' && id && path.includes('/results')) {
      const run = await ddb.getItem<ITestRun>(TEST_RUNS_TABLE, { id });
      if (!run || run.tenantId !== tenantId) return notFound();
      const results = await ddb.queryItems<ITestResult>(
        TEST_RESULTS_TABLE, 'runId = :r', { ':r': id }, undefined, 'runId-index',
      );
      return ok(results);
    }

    // PUT /test-runs/:runId/results/:resultId/review
    if (method === 'PUT' && id && path.includes('/review')) {
      const resultIdMatch = path.match(/\/results\/([^/]+)\/review/);
      const resultId = resultIdMatch?.[1];
      if (!resultId) return badRequest('resultId required');

      const result = await ddb.getItem<ITestResult>(TEST_RESULTS_TABLE, { id: resultId });
      if (!result || result.tenantId !== tenantId) return notFound();

      await ddb.updateItem(TEST_RESULTS_TABLE, { id: resultId }, {
        userReview: {
          rating: body['rating'] as number,
          feedback: (body['feedback'] as string) || '',
          tags: (body['tags'] as string[]) || [],
          reviewedAt: new Date().toISOString(),
        },
      });
      return ok({ success: true });
    }

    // POST /test-runs/:runId/analyze — trigger AI improvement analysis
    if (method === 'POST' && id && path.endsWith('/analyze')) {
      const run = await ddb.getItem<ITestRun>(TEST_RUNS_TABLE, { id });
      if (!run || run.tenantId !== tenantId) return notFound();

      const { analyzeRunResults } = await import('../services/test-improvement');
      const improvements = await analyzeRunResults(id, run.assistantId, tenantId);

      await ddb.updateItem(TEST_RUNS_TABLE, { id }, {
        improvements,
        updatedAt: new Date().toISOString(),
      });

      return ok(improvements);
    }

    // GET /test-runs/:runId/improvements
    if (method === 'GET' && id && path.includes('/improvements')) {
      const run = await ddb.getItem<ITestRun>(TEST_RUNS_TABLE, { id });
      if (!run || run.tenantId !== tenantId) return notFound();
      return ok(run.improvements ?? []);
    }

    // POST /test-runs/:runId/improvements/:improvementId/apply
    if (method === 'POST' && id && path.includes('/improvements/') && path.endsWith('/apply')) {
      const improvementIdMatch = path.match(/\/improvements\/([^/]+)\/apply/);
      const improvementId = improvementIdMatch?.[1];
      if (!improvementId) return badRequest('improvementId required');

      const run = await ddb.getItem<ITestRun>(TEST_RUNS_TABLE, { id });
      if (!run || run.tenantId !== tenantId) return notFound();

      const { applyImprovement } = await import('../services/test-improvement');
      await applyImprovement(run as any, improvementId);

      return ok({ success: true });
    }

    // DELETE /test-runs/:runId — cancel run
    if (method === 'DELETE' && id) {
      const run = await ddb.getItem<ITestRun>(TEST_RUNS_TABLE, { id });
      if (!run || run.tenantId !== tenantId) return notFound();

      if (run.status === 'running' || run.status === 'queued') {
        await ddb.updateItem(TEST_RUNS_TABLE, { id }, {
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
        });
      }
      return noContent();
    }

    return notFound();
  } catch (e) {
    console.error('test-runs handler error', e);
    return serverError(String(e));
  }
}
