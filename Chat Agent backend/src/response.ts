import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS']?.split(',').map(s => s.trim()).filter(Boolean) ?? [];

function getCorsOrigin(requestOrigin?: string): string {
  if (ALLOWED_ORIGINS.length === 0) return '*';
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return ALLOWED_ORIGINS[0];
}

export function corsHeaders(requestOrigin?: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(requestOrigin),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Organization-Id',
    'Access-Control-Max-Age': '300',
    ...(ALLOWED_ORIGINS.length > 0 ? { 'Vary': 'Origin' } : {}),
  };
}

/** @deprecated Use corsHeaders(origin) for per-request CORS. Kept for backward compat. */
export const CORS_HEADERS = corsHeaders();

function jsonHeaders(requestOrigin?: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...corsHeaders(requestOrigin) };
}

export const cors = (requestOrigin?: string): APIGatewayProxyResultV2 => ({
  statusCode: 200,
  headers: corsHeaders(requestOrigin),
  body: '',
});

export const ok = (data: unknown): APIGatewayProxyResultV2 => ({
  statusCode: 200,
  headers: jsonHeaders(),
  body: JSON.stringify(data),
});

export const created = (data: unknown): APIGatewayProxyResultV2 => ({
  statusCode: 201,
  headers: jsonHeaders(),
  body: JSON.stringify(data),
});

export const noContent = (): APIGatewayProxyResultV2 => ({
  statusCode: 204,
  headers: jsonHeaders(),
  body: '',
});

export const badRequest = (message: string): APIGatewayProxyResultV2 => ({
  statusCode: 400,
  headers: jsonHeaders(),
  body: JSON.stringify({ error: message }),
});

export const unauthorized = (message = 'Unauthorized'): APIGatewayProxyResultV2 => ({
  statusCode: 401,
  headers: jsonHeaders(),
  body: JSON.stringify({ error: message }),
});

export const forbidden = (message = 'Forbidden'): APIGatewayProxyResultV2 => ({
  statusCode: 403,
  headers: jsonHeaders(),
  body: JSON.stringify({ error: message }),
});

export const notFound = (message = 'Not found'): APIGatewayProxyResultV2 => ({
  statusCode: 404,
  headers: jsonHeaders(),
  body: JSON.stringify({ error: message }),
});

/**
 * Return a generic error to the client. The real error is logged with a
 * correlation ID so it can be traced in CloudWatch without leaking internals.
 */
export const serverError = (internalDetail?: string): APIGatewayProxyResultV2 => {
  const correlationId = uuidv4();
  if (internalDetail) {
    console.error(`[${correlationId}] Internal error:`, internalDetail);
  }
  return {
    statusCode: 500,
    headers: jsonHeaders(),
    body: JSON.stringify({ error: 'Internal server error', correlationId }),
  };
};
