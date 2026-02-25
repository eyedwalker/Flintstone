import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/**
 * Extracts the verified tenant ID (Cognito sub claim) from the JWT authorizer context.
 * API Gateway has already validated the JWT before this Lambda runs.
 */
export function getTenantId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext.authorizer.jwt.claims['sub'];
  return typeof sub === 'string' ? sub : '';
}

/** Parse and validate that the resource belongs to the requesting tenant */
export function assertOwnership(
  resourceTenantId: string,
  requestTenantId: string
): boolean {
  return resourceTenantId === requestTenantId;
}

/** Safe JSON body parse — returns null on failure */
export function parseBody<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
