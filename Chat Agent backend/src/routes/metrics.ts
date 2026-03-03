import { APIGatewayProxyResultV2 } from 'aws-lambda';
import * as ddb from '../services/dynamo';
import { ok, badRequest, serverError } from '../response';
import { IRequestContext } from '../auth';

const TABLE = process.env['METRICS_TABLE'] ?? '';

export async function handleMetrics(
  method: string,
  _path: string,
  _body: Record<string, unknown>,
  _params: Record<string, string>,
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
    return ok([]);
  } catch (e) {
    console.error('metrics handler error', e);
    return serverError(String(e));
  }
}
