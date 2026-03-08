import { APIGatewayProxyResultV2 } from 'aws-lambda';
import * as ddb from '../services/dynamo';
import { ok, badRequest, notFound, serverError, noContent } from '../response';
import { IRequestContext, requireRole } from '../auth';

const SCREEN_MAPPINGS_TABLE = process.env['SCREEN_MAPPINGS_TABLE'] ?? '';
const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';

interface IScreenMapping {
  id: string;
  assistantId: string;
  tenantId: string;
  screenName: string;
  section: string;
  urlPattern: string;
  urlRegex: string;
  purpose: string;
  videos: unknown[];
  trendingQuestions: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Authenticated CRUD + AI generation for screen mappings.
 */
export async function handleScreenMappings(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  ctx: IRequestContext,
): Promise<APIGatewayProxyResultV2> {
  const tenantId = ctx.organizationId;

  try {
    // Write operations require admin
    if (method !== 'GET' && !requireRole(ctx, 'admin')) {
      return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Admin role required' }) };
    }

    // POST /screen-mappings/generate — AI-generate mappings for an assistant
    // Routes to TestRunnerFunction (15-min timeout) because loading 200+ video
    // transcripts and AI-matching each screen takes several minutes.
    if (method === 'POST' && path.endsWith('/generate')) {
      const assistantId = body['assistantId'] as string;
      if (!assistantId) return badRequest('assistantId required');

      const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
      const lambdaClient = new LambdaClient({});
      await lambdaClient.send(new InvokeCommand({
        FunctionName: process.env['TEST_RUNNER_FUNCTION_NAME'] || '',
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          _screenMappingGeneration: { assistantId, tenantId },
        })),
      }));

      return ok({ status: 'generating', message: 'Generating screen mappings in background. Refresh in a minute to see results.' });
    }

    // GET /screen-mappings?assistantId=xxx — list all mappings for an assistant
    if (method === 'GET' && !params['id']) {
      const assistantId = query['assistantId'];
      if (!assistantId) return badRequest('assistantId query param required');

      const items = await ddb.queryItems<IScreenMapping>(
        SCREEN_MAPPINGS_TABLE,
        '#a = :a',
        { ':a': assistantId },
        { '#a': 'assistantId' },
        'assistantId-index',
      );
      return ok(items);
    }

    const id = params['id'];

    // GET /screen-mappings/:id
    if (method === 'GET' && id) {
      const item = await ddb.getItem<IScreenMapping>(SCREEN_MAPPINGS_TABLE, { id });
      if (!item) return notFound();
      return ok(item);
    }

    // PUT /screen-mappings/:id — update a mapping (admin edit)
    if (method === 'PUT' && id) {
      const item = await ddb.getItem<IScreenMapping>(SCREEN_MAPPINGS_TABLE, { id });
      if (!item) return notFound();
      if (item.tenantId !== tenantId) return notFound();

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (body['videos'] !== undefined) updates['videos'] = body['videos'];
      if (body['trendingQuestions'] !== undefined) updates['trendingQuestions'] = body['trendingQuestions'];
      if (body['status'] !== undefined) updates['status'] = body['status'];
      if (body['screenName'] !== undefined) updates['screenName'] = body['screenName'];
      if (body['urlPattern'] !== undefined) {
        updates['urlPattern'] = body['urlPattern'];
        updates['urlRegex'] = (body['urlPattern'] as string)
          .replace(/\{[^}]+\}/g, '[^/]+')
          .replace(/\//g, '\\/');
      }

      await ddb.updateItem(SCREEN_MAPPINGS_TABLE, { id }, updates);
      return ok({ ...item, ...updates });
    }

    // DELETE /screen-mappings/:id
    if (method === 'DELETE' && id) {
      const item = await ddb.getItem<IScreenMapping>(SCREEN_MAPPINGS_TABLE, { id });
      if (!item) return notFound();
      if (item.tenantId !== tenantId) return notFound();
      await ddb.deleteItem(SCREEN_MAPPINGS_TABLE, { id });
      return noContent();
    }

    return notFound();
  } catch (e) {
    console.error('screen-mappings handler error', e);
    return serverError(String(e));
  }
}

/**
 * Public widget endpoint — authenticated via API key.
 * GET /widget/screen-context?apiKey=xxx&url=/patient/123/demographics
 */
export async function handleWidgetScreenContext(
  query: Record<string, string>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = query['apiKey'];
    const url = query['url'];
    if (!apiKey || !url) return badRequest('apiKey and url query params required');

    // Look up assistant by API key
    const assistants = await ddb.queryItems<{ id: string; tenantId: string }>(
      ASSISTANTS_TABLE,
      'apiKey = :k',
      { ':k': apiKey },
      undefined,
      'apiKey-index',
    );
    if (assistants.length === 0) return notFound('Invalid API key');
    const assistant = assistants[0];

    // Get all screen mappings for this assistant
    const mappings = await ddb.queryItems<IScreenMapping>(
      SCREEN_MAPPINGS_TABLE,
      '#a = :a',
      { ':a': assistant.id },
      { '#a': 'assistantId' },
      'assistantId-index',
    );

    // Try to match the URL against each mapping's regex
    for (const mapping of mappings) {
      try {
        const regex = new RegExp(mapping.urlRegex);
        if (regex.test(url)) {
          return ok({
            screenName: mapping.screenName,
            section: mapping.section,
            videos: mapping.videos,
            trendingQuestions: mapping.trendingQuestions,
          });
        }
      } catch {
        // Invalid regex, skip
      }
    }

    // No match — return empty so widget uses defaults
    return ok({ screenName: null, videos: [], trendingQuestions: [] });
  } catch (e) {
    console.error('widget screen-context error', e);
    return serverError(String(e));
  }
}
