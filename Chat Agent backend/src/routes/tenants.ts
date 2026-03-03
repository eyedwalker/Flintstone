import { APIGatewayProxyResultV2 } from 'aws-lambda';
import * as ddb from '../services/dynamo';
import { ok, forbidden, serverError } from '../response';
import { IRequestContext, requireRole } from '../auth';

const TABLE = process.env['TENANTS_TABLE'] ?? '';

export async function handleTenants(
  method: string,
  _path: string,
  body: Record<string, unknown>,
  _params: Record<string, string>,
  _query: Record<string, string>,
  ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  const tenantId = ctx.organizationId;
  try {
    // GET /tenants/me — viewer+
    if (method === 'GET') {
      const tenant = await ddb.getItem(TABLE, { id: tenantId });
      return ok(tenant ?? { id: tenantId, plan: 'free' });
    }

    // PUT /tenants/me — owner only
    if (method === 'PUT') {
      if (!requireRole(ctx, 'owner')) return forbidden('Owner role required');
      const { id: _id, ...rest } = body; void _id;
      const updates: Record<string, unknown> = { ...rest, updatedAt: new Date().toISOString() };
      const existing = await ddb.getItem<Record<string, unknown>>(TABLE, { id: tenantId });
      if (existing) {
        await ddb.updateItem(TABLE, { id: tenantId }, updates);
      } else {
        await ddb.putItem(TABLE, { id: tenantId, ...updates, createdAt: new Date().toISOString() });
      }
      return ok({ id: tenantId, ...updates });
    }

    return ok(null);
  } catch (e) {
    console.error('tenants handler error', e);
    return serverError(String(e));
  }
}
