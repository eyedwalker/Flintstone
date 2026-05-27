/**
 * Twilio webhook signature validation.
 *
 * Twilio signs every webhook with HMAC-SHA1(URL + sortedParams, AuthToken).
 * Verifying the signature is the only reliable way to confirm a webhook
 * actually came from Twilio (Twilio webhooks are unauthenticated otherwise).
 *
 * Reference: https://www.twilio.com/docs/usage/security#validating-requests
 *
 * Signature input format:
 *   - For POST with form-urlencoded body: URL + concat(sortedKey+value for each param)
 *   - For GET: just the URL with its query string
 *
 * We treat the header `X-Twilio-Signature` (case-insensitive) as the expected value.
 *
 * Tenancy:
 *   The AuthToken is per-tenant. The handler caller resolves which token to
 *   use (today: DEFAULT_TENANT_ID; multi-tenant will look up by To number).
 *
 * Bypass:
 *   When `TWILIO_SIGNATURE_VALIDATION` env var equals "disabled", this module
 *   short-circuits to `true` — local dev / unit tests that hand-craft requests
 *   never have a valid signature.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export interface IValidateOptions {
  /** Value of the X-Twilio-Signature header. */
  signatureHeader: string | undefined;
  /** Full URL Twilio called, exactly as configured on the Twilio number. */
  url: string;
  /** Parsed form-urlencoded body params (or {} for GET). */
  body: Record<string, string>;
  /** Twilio Auth Token for the tenant the request belongs to. */
  authToken: string;
}

export function isValidationDisabled(): boolean {
  return process.env['TWILIO_SIGNATURE_VALIDATION'] === 'disabled';
}

export function validateTwilioSignature(opts: IValidateOptions): boolean {
  if (isValidationDisabled()) return true;
  if (!opts.signatureHeader || !opts.authToken || !opts.url) return false;

  const sortedKeys = Object.keys(opts.body).sort();
  const concatenated = sortedKeys.map((k) => k + opts.body[k]).join('');
  const data = opts.url + concatenated;
  const expected = createHmac('sha1', opts.authToken).update(data).digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Read the X-Twilio-Signature header out of an APIGatewayV2 headers map,
 * tolerating case variations.
 */
export function getSignatureHeader(headers: Record<string, string | undefined>): string | undefined {
  return (
    headers['x-twilio-signature']
    ?? headers['X-Twilio-Signature']
    ?? headers['X-TWILIO-SIGNATURE']
  );
}

/**
 * Reconstruct the full URL Twilio called, given an API Gateway v2 event.
 * Prefers `TWILIO_WEBHOOK_BASE_URL` env var if set (most reliable: matches the
 * URL configured in the Twilio console). Otherwise falls back to host header
 * + rawPath, which works in single-stage deployments.
 */
export function reconstructWebhookUrl(opts: {
  host: string;
  rawPath: string;
  stage?: string;
  rawQueryString?: string;
}): string {
  const envBase = process.env['TWILIO_WEBHOOK_BASE_URL']?.replace(/\/$/, '');
  const base = envBase ?? `https://${opts.host}${opts.stage ? opts.stage : ''}`;
  const url = `${base}${opts.rawPath}`;
  return opts.rawQueryString ? `${url}?${opts.rawQueryString}` : url;
}

// Module-scope cache for the Twilio auth token. Loaded lazily on first
// validation call; lives for the Lambda lifetime. Reset for tests by clearing
// the cached map.
const authTokenCache = new Map<string, { value: string; loadedAt: number }>();
const AUTH_TOKEN_TTL_MS = 5 * 60 * 1000;

export function clearAuthTokenCache(): void {
  authTokenCache.clear();
}

async function loadAuthToken(tenantId: string): Promise<string> {
  const cached = authTokenCache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < AUTH_TOKEN_TTL_MS) return cached.value;

  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const ssm = new SSMClient({ region: process.env['REGION'] ?? 'us-west-2' });
  const res = await ssm.send(new GetParameterCommand({
    Name: `/chat-agent/${tenantId}/twilio/auth-token`,
    WithDecryption: true,
  }));
  const value = res.Parameter?.Value ?? '';
  if (value) authTokenCache.set(tenantId, { value, loadedAt: Date.now() });
  return value;
}

/**
 * End-to-end validation of an inbound Twilio webhook. Loads the tenant's auth
 * token, reconstructs the URL, runs the HMAC check. Returns true/false; never
 * throws. Logs the reason on rejection for observability.
 *
 * Bypass: when TWILIO_SIGNATURE_VALIDATION=disabled, returns true without
 * any work (useful for local dev + tests).
 */
export async function validateInboundWebhook(opts: {
  tenantId: string;
  headers: Record<string, string | undefined>;
  body: Record<string, string>;
  host: string;
  rawPath: string;
  stage?: string;
  rawQueryString?: string;
}): Promise<boolean> {
  if (isValidationDisabled()) return true;

  const signatureHeader = getSignatureHeader(opts.headers);
  if (!signatureHeader) {
    console.warn(`[TwilioAuth] missing X-Twilio-Signature on ${opts.rawPath}`);
    return false;
  }

  let authToken = '';
  try {
    authToken = await loadAuthToken(opts.tenantId);
  } catch (err) {
    console.error(`[TwilioAuth] failed to load auth token for tenant ${opts.tenantId}:`, err);
    return false;
  }
  if (!authToken) {
    console.warn(`[TwilioAuth] no auth token configured for tenant ${opts.tenantId}`);
    return false;
  }

  const url = reconstructWebhookUrl({
    host: opts.host,
    rawPath: opts.rawPath,
    stage: opts.stage,
    rawQueryString: opts.rawQueryString,
  });

  const ok = validateTwilioSignature({ signatureHeader, url, body: opts.body, authToken });
  if (!ok) console.warn(`[TwilioAuth] signature mismatch on ${opts.rawPath}`);
  return ok;
}
