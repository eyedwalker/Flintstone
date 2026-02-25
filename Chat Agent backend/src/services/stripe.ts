import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import Stripe from 'stripe';

const ssm = new SSMClient({ region: process.env['REGION'] ?? 'us-east-1' });
const PARAM_NAME = process.env['STRIPE_SECRET_KEY_PARAM'] ?? '';

let stripeClient: Stripe | null = null;

/** Lazy-load Stripe client — fetches secret key from SSM on first call */
async function getStripe(): Promise<Stripe> {
  if (stripeClient) return stripeClient;
  const res = await ssm.send(new GetParameterCommand({
    Name: PARAM_NAME,
    WithDecryption: true,
  }));
  const key = res.Parameter?.Value;
  if (!key) throw new Error('Stripe secret key not found in SSM');
  stripeClient = new Stripe(key);
  return stripeClient;
}

export async function createCheckoutSession(params: {
  tenantId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
}): Promise<{ url: string; sessionId: string }> {
  const stripe = await getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.tenantId,
    ...(params.customerId ? { customer: params.customerId } : {}),
    metadata: { tenantId: params.tenantId },
  });
  return { url: session.url ?? '', sessionId: session.id };
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const stripe = await getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

export async function constructWebhookEvent(
  payload: string,
  sig: string,
  secret: string
): Promise<Stripe.Event> {
  const stripe = await getStripe();
  return stripe.webhooks.constructEvent(payload, sig, secret);
}
