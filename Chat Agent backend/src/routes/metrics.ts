import { APIGatewayProxyResultV2 } from 'aws-lambda';
import * as ddb from '../services/dynamo';
import { ok, badRequest, unauthorized, serverError } from '../response';
import { IRequestContext } from '../auth';
import { findAssistantByApiKey } from './widget-chat';

const TABLE = process.env['METRICS_TABLE'] ?? '';

export async function handleMetrics(
  method: string,
  _path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  _ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  try {
    if (method === 'GET') {
      const assistantId = query['assistantId'];
      if (!assistantId) return badRequest('assistantId query param required');
      const items = await ddb.queryItems(
        TABLE,
        '#a = :a',
        { ':a': assistantId },
        { '#a': 'assistantId' },
        'assistantId-index'
      );
      return ok(items);
    }

    // PUT /metrics/:id — update satisfaction feedback
    if (method === 'PUT') {
      const metricId = params['id'];
      if (!metricId) return badRequest('metric id required');
      if (typeof body['satisfied'] !== 'boolean') return badRequest('satisfied (boolean) required');
      await ddb.updateItem(TABLE, { id: metricId }, { satisfied: body['satisfied'] });
      return ok({ success: true });
    }

    return ok([]);
  } catch (e) {
    console.error('metrics handler error', e);
    return serverError(String(e));
  }
}

/**
 * POST /widget/feedback — public endpoint for widget thumbs up/down.
 * Authenticates via x-api-key header.
 * Body: { metricId, satisfied }
 */
export async function handleWidgetFeedback(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const assistant = await findAssistantByApiKey(apiKey);
    if (!assistant) return unauthorized('Invalid API key');

    const metricId = body['metricId'] as string;
    if (!metricId) return badRequest('metricId required');
    if (typeof body['satisfied'] !== 'boolean') return badRequest('satisfied (boolean) required');

    await ddb.updateItem(TABLE, { id: metricId }, { satisfied: body['satisfied'] });
    return ok({ success: true });
  } catch (e) {
    console.error('widget feedback error', e);
    return serverError(String(e));
  }
}
