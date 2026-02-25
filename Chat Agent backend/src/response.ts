import { APIGatewayProxyResultV2 } from 'aws-lambda';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key',
  'Access-Control-Max-Age': '300',
};

const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

export const cors = (): APIGatewayProxyResultV2 => ({
  statusCode: 200,
  headers: CORS_HEADERS,
  body: '',
});

export const ok = (data: unknown): APIGatewayProxyResultV2 => ({
  statusCode: 200,
  headers: JSON_HEADERS,
  body: JSON.stringify(data),
});

export const created = (data: unknown): APIGatewayProxyResultV2 => ({
  statusCode: 201,
  headers: JSON_HEADERS,
  body: JSON.stringify(data),
});

export const noContent = (): APIGatewayProxyResultV2 => ({
  statusCode: 204,
  headers: JSON_HEADERS,
  body: '',
});

export const badRequest = (message: string): APIGatewayProxyResultV2 => ({
  statusCode: 400,
  headers: JSON_HEADERS,
  body: JSON.stringify({ error: message }),
});

export const unauthorized = (message = 'Unauthorized'): APIGatewayProxyResultV2 => ({
  statusCode: 401,
  headers: JSON_HEADERS,
  body: JSON.stringify({ error: message }),
});

export const forbidden = (message = 'Forbidden'): APIGatewayProxyResultV2 => ({
  statusCode: 403,
  headers: JSON_HEADERS,
  body: JSON.stringify({ error: message }),
});

export const notFound = (message = 'Not found'): APIGatewayProxyResultV2 => ({
  statusCode: 404,
  headers: JSON_HEADERS,
  body: JSON.stringify({ error: message }),
});

export const serverError = (message = 'Internal server error'): APIGatewayProxyResultV2 => ({
  statusCode: 500,
  headers: JSON_HEADERS,
  body: JSON.stringify({ error: message }),
});
