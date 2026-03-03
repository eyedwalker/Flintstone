import { APIGatewayProxyResultV2 } from 'aws-lambda';
import * as guardrails from '../services/bedrock-guardrails';
import { ok, created, badRequest, forbidden, serverError } from '../response';
import { IRequestContext, requireRole, parseBody } from '../auth';

export async function handleGuardrails(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  _query: Record<string, string>,
  ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  try {
    // Guardrails: write operations require editor+
    if (method !== 'GET' && !requireRole(ctx, 'editor')) return forbidden('Editor role required');
    const id = params['id'];

    // POST /guardrails
    if (method === 'POST' && !id) {
      const b = parseBody<Record<string, unknown>>(JSON.stringify(body));
      if (!b) return badRequest('Body required');
      const result = await guardrails.createGuardrail(b as never);
      return created(result);
    }

    // PUT /guardrails/:id
    if (method === 'PUT' && id && !path.endsWith('/test')) {
      const b = parseBody<Record<string, unknown>>(JSON.stringify(body));
      if (!b) return badRequest('Body required');
      await guardrails.updateGuardrail(id, b as never);
      return ok({ success: true });
    }

    // POST /guardrails/:id/test
    if (method === 'POST' && path.endsWith('/test')) {
      const b = parseBody<{ input: string; source: 'INPUT' | 'OUTPUT'; version?: string }>(JSON.stringify(body));
      if (!b?.input) return badRequest('input required');
      const result = await guardrails.testGuardrail(id!, b.version ?? 'DRAFT', b.input, b.source ?? 'INPUT');
      return ok(result);
    }

    return ok({ error: 'Not found' });
  } catch (e) {
    console.error('guardrails handler error', e);
    return serverError(String(e));
  }
}
