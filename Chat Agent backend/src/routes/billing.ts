import { APIGatewayProxyResultV2 } from 'aws-lambda';
import * as stripe from '../services/stripe';
import { ok, badRequest, forbidden, serverError } from '../response';
import { IRequestContext, requireRole, parseBody } from '../auth';

const FRONTEND_URL = process.env['FRONTEND_URL'] ?? 'https://localhost:4200';

export async function handleBilling(
  method: string,
  path: string,
  body: Record<string, unknown>,
  _params: Record<string, string>,
  _query: Record<string, string>,
  ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  const tenantId = ctx.organizationId;
  try {
    // Billing: GET requires admin, POST requires owner
    if (method === 'GET' && !requireRole(ctx, 'admin')) return forbidden('Admin role required');
    if (method === 'POST' && !requireRole(ctx, 'owner')) return forbidden('Owner role required');

    // POST /billing/checkout
    if (method === 'POST' && path.endsWith('/checkout')) {
      const b = parseBody<{
        priceId: string;
        successUrl?: string;
        cancelUrl?: string;
        customerId?: string;
      }>(JSON.stringify(body));
      if (!b?.priceId) return badRequest('priceId required');
      const result = await stripe.createCheckoutSession({
        tenantId,
        priceId: b.priceId,
        successUrl: b.successUrl ?? `${FRONTEND_URL}/dashboard?upgraded=true`,
        cancelUrl: b.cancelUrl ?? `${FRONTEND_URL}/billing`,
        customerId: b.customerId,
      });
      return ok(result);
    }

    // GET /billing/portal-url?customerId=xxx&returnUrl=xxx
    if (method === 'GET' && path.endsWith('/portal-url')) {
      const b = parseBody<{ customerId: string; returnUrl?: string }>(JSON.stringify(body));
      const customerId = b?.customerId;
      if (!customerId) return badRequest('customerId required');
      const url = await stripe.createPortalSession(
        customerId,
        b.returnUrl ?? `${FRONTEND_URL}/billing`
      );
      return ok({ url });
    }

    return ok(null);
  } catch (e) {
    console.error('billing handler error', e);
    return serverError(String(e));
  }
}
