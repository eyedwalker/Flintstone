/**
 * RAFT Pipeline Routes — training datasets, fine-tuning jobs, iterations.
 */

import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { ok, badRequest, notFound, serverError } from '../response';
import { IRequestContext, requireRole } from '../auth';

export async function handleRaft(
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

    // ── Datasets ────────────────────────────────────────────────────────────

    // POST /raft/datasets — generate training dataset
    if (method === 'POST' && path === '/raft/datasets') {
      const { generateDataset } = await import('../services/training-dataset');
      const dataset = await generateDataset(
        (body['name'] as string) || 'Training Dataset',
        body['assistantId'] as string,
        tenantId,
        body['sourceRunIds'] as string[],
        (body['format'] as any) || 'bedrock-llama',
        body['splitConfig'] as any,
      );
      return ok(dataset);
    }

    // GET /raft/datasets?assistantId=xxx — list datasets
    if (method === 'GET' && path === '/raft/datasets') {
      const assistantId = query['assistantId'];
      if (!assistantId) return badRequest('assistantId required');
      const { listDatasets } = await import('../services/training-dataset');
      return ok(await listDatasets(assistantId, tenantId));
    }

    // GET /raft/datasets/:id — get dataset
    if (method === 'GET' && path.match(/^\/raft\/datasets\/[^/]+$/)) {
      const id = path.split('/')[3];
      const { getDataset } = await import('../services/training-dataset');
      const dataset = await getDataset(id);
      if (!dataset || dataset.tenantId !== tenantId) return notFound();
      return ok(dataset);
    }

    // GET /raft/datasets/:id/preview — preview dataset
    if (method === 'GET' && path.includes('/preview')) {
      const assistantId = query['assistantId'];
      const runIds = (query['runIds'] || '').split(',').filter(Boolean);
      if (!assistantId || !runIds.length) return badRequest('assistantId and runIds required');
      const { previewDataset } = await import('../services/training-dataset');
      return ok(await previewDataset(assistantId, tenantId, runIds));
    }

    // DELETE /raft/datasets/:id — delete dataset
    if (method === 'DELETE' && path.match(/^\/raft\/datasets\/[^/]+$/)) {
      const id = path.split('/')[3];
      const { deleteDataset } = await import('../services/training-dataset');
      await deleteDataset(id, tenantId);
      return ok({ success: true });
    }

    // ── Fine-Tuning Jobs ──────────────────────────────────────────────────

    // POST /raft/jobs — start fine-tuning job
    if (method === 'POST' && path === '/raft/jobs') {
      const { startFineTuning } = await import('../services/finetuning-manager');
      const { getDataset } = await import('../services/training-dataset');
      const datasetId = body['datasetId'] as string;
      const dataset = await getDataset(datasetId);
      if (!dataset || dataset.tenantId !== tenantId) return badRequest('Dataset not found');

      const job = await startFineTuning(
        body['assistantId'] as string,
        tenantId,
        datasetId,
        dataset.s3Key,
        body['baseModelId'] as string,
        body['hyperparameters'] as any,
        (body['iteration'] as number) ?? 1,
      );
      return ok(job);
    }

    // GET /raft/jobs?assistantId=xxx — list jobs
    if (method === 'GET' && path === '/raft/jobs') {
      const assistantId = query['assistantId'];
      if (!assistantId) return badRequest('assistantId required');
      const { listJobs } = await import('../services/finetuning-manager');
      return ok(await listJobs(assistantId, tenantId));
    }

    // GET /raft/jobs/:id — get job status (polls Bedrock)
    if (method === 'GET' && path.match(/^\/raft\/jobs\/[^/]+$/)) {
      const id = path.split('/')[3];
      const { checkJobStatus } = await import('../services/finetuning-manager');
      const job = await checkJobStatus(id);
      if (job.tenantId !== tenantId) return notFound();
      return ok(job);
    }

    // POST /raft/jobs/:id/cancel — cancel job
    if (method === 'POST' && path.includes('/cancel')) {
      const id = path.split('/')[3];
      const { cancelJob } = await import('../services/finetuning-manager');
      await cancelJob(id);
      return ok({ success: true });
    }

    // POST /raft/jobs/:id/deploy — deploy fine-tuned model
    if (method === 'POST' && path.includes('/deploy')) {
      const id = path.split('/')[3];
      const modelUnits = (body['modelUnits'] as number) ?? 1;
      const { deployModel } = await import('../services/finetuning-manager');
      const result = await deployModel(id, modelUnits);
      return ok(result);
    }

    // POST /raft/reformulate — reformulate test prompts for next cycle
    if (method === 'POST' && path === '/raft/reformulate') {
      const suiteId = body['suiteId'] as string;
      const previousRunId = body['previousRunId'] as string;
      const pct = (body['reformulationPct'] as number) ?? 0.3;
      if (!suiteId || !previousRunId) return badRequest('suiteId and previousRunId required');

      const { reformulateTestCases } = await import('../services/prompt-reformulator');
      const result = await reformulateTestCases(suiteId, tenantId, previousRunId, pct);
      return ok(result);
    }

    // GET /raft/models — list fine-tunable base models
    if (method === 'GET' && path === '/raft/models') {
      const { getFineTunableModels } = await import('../services/finetuning-manager');
      return ok(getFineTunableModels());
    }

    // ── RAFT Iterations ─────────────────────────────────────────────────

    // POST /raft/iterations — start a new RAFT cycle
    if (method === 'POST' && path === '/raft/iterations') {
      const { startCycle } = await import('../services/raft-orchestrator');
      const iteration = await startCycle(
        body['assistantId'] as string,
        tenantId,
        body['testRunId'] as string,
        {
          track: (body['track'] as any) ?? 'hybrid',
          reformulationPct: body['reformulationPct'] as number,
        },
      );
      return ok(iteration);
    }

    // GET /raft/iterations?assistantId=xxx — list iterations
    if (method === 'GET' && path === '/raft/iterations') {
      const assistantId = query['assistantId'];
      if (!assistantId) return badRequest('assistantId required');
      const { getHistory } = await import('../services/raft-orchestrator');
      return ok(await getHistory(assistantId, tenantId));
    }

    // GET /raft/iterations/:id — get iteration
    if (method === 'GET' && path.match(/^\/raft\/iterations\/[^/]+$/)) {
      const id = path.split('/')[3];
      const { getIteration } = await import('../services/raft-orchestrator');
      const iteration = await getIteration(id);
      if (!iteration || iteration.tenantId !== tenantId) return notFound();
      return ok(iteration);
    }

    // GET /raft/iterations/:id/prerequisites — check if can advance
    if (method === 'GET' && path.includes('/prerequisites')) {
      const id = path.split('/')[3];
      const { checkPrerequisites } = await import('../services/raft-orchestrator');
      return ok(await checkPrerequisites(id));
    }

    // POST /raft/iterations/:id/advance — advance to next phase (with gates)
    if (method === 'POST' && path.includes('/advance')) {
      const id = path.split('/')[3];
      const { advanceCycle } = await import('../services/raft-orchestrator');
      const result = await advanceCycle(id, body as any);
      if ((result as any).prerequisiteError) {
        return { statusCode: 422, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          error: (result as any).prerequisiteError,
          canAdvance: false,
        }) };
      }
      return ok(result);
    }

    // PUT /raft/iterations/:id — update iteration data
    if (method === 'PUT' && path.match(/^\/raft\/iterations\/[^/]+$/)) {
      const id = path.split('/')[3];
      const { updateIteration, getIteration } = await import('../services/raft-orchestrator');
      await updateIteration(id, body as any);
      return ok(await getIteration(id));
    }

    // ── Comparisons ─────────────────────────────────────────────────────

    // POST /raft/comparisons — compare two test runs
    if (method === 'POST' && path === '/raft/comparisons') {
      const { compareRuns } = await import('../services/model-comparison');
      const comparison = await compareRuns(
        body['baseRunId'] as string,
        body['challengerRunId'] as string,
        tenantId,
      );
      return ok(comparison);
    }

    // GET /raft/comparisons/:id — get comparison
    if (method === 'GET' && path.match(/^\/raft\/comparisons\/[^/]+$/)) {
      const id = path.split('/')[3];
      const { getComparison } = await import('../services/model-comparison');
      const comparison = await getComparison(id);
      if (!comparison || comparison.tenantId !== tenantId) return notFound();
      return ok(comparison);
    }

    return notFound();
  } catch (e) {
    console.error('raft handler error', e);
    return serverError(String(e));
  }
}
