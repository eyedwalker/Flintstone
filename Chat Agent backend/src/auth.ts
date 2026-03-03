import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import * as ddb from './services/dynamo';
import * as audit from './services/audit';

const TEAM_MEMBERS_TABLE = process.env['TEAM_MEMBERS_TABLE'] ?? '';
const TENANTS_TABLE = process.env['TENANTS_TABLE'] ?? '';

export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';

export const ROLE_LEVEL: Record<TeamRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

/** Maps node-user role strings to numeric access levels for KB content filtering */
export const NODE_ROLE_LEVEL: Record<string, number> = {
  public: 0,
  authenticated: 1,
  staff: 2,
  doctor: 3,
  admin: 4,
  super_admin: 99,
};

/** Resolve a node-user role string to a numeric level (defaults to 0) */
export function resolveNodeRole(roleName: string): number {
  return NODE_ROLE_LEVEL[roleName] ?? 0;
}

export interface IRequestContext {
  userId: string;
  organizationId: string;
  role: TeamRole;
  email: string;
}

export interface ITeamMember {
  PK: string;
  SK: string;
  userId: string;
  organizationId: string;
  role: TeamRole;
  email: string;
  name: string;
  mfaEnabled?: boolean;
  invitedBy?: string;
  joinedAt: string;
  updatedAt: string;
}

/**
 * Resolves the full request context from JWT claims + team membership.
 *
 * Flow:
 * 1. Extract userId (sub) from JWT
 * 2. Determine organizationId from X-Organization-Id header or userId-index lookup
 * 3. Look up team membership record
 * 4. If no record found, attempt lazy migration for legacy single-user tenants
 */
export async function resolveRequestContext(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<IRequestContext | null> {
  const sub = event.requestContext.authorizer.jwt.claims['sub'];
  const userId = typeof sub === 'string' ? sub : '';
  if (!userId) return null;

  const email = (event.requestContext.authorizer.jwt.claims['email'] as string) ?? '';

  // Determine active organization
  let organizationId = event.headers['x-organization-id'] ?? '';

  if (!organizationId) {
    // No org header — look up all orgs this user belongs to
    const memberships = await ddb.queryItems<ITeamMember>(
      TEAM_MEMBERS_TABLE,
      'userId = :u',
      { ':u': userId },
      undefined,
      'userId-index'
    );

    if (memberships.length > 0) {
      organizationId = memberships[0].organizationId;
    } else {
      // No memberships found — attempt lazy migration
      const migrated = await lazyMigrate(userId, email);
      if (migrated) {
        organizationId = userId;
      } else {
        return null;
      }
    }
  }

  // Look up team membership for this org
  const member = await ddb.getItem<ITeamMember>(
    TEAM_MEMBERS_TABLE,
    { PK: `ORG#${organizationId}`, SK: `USER#${userId}` }
  );

  if (!member) {
    // Try lazy migration if the org matches the userId (legacy single-user case)
    if (organizationId === userId) {
      const migrated = await lazyMigrate(userId, email);
      if (migrated) {
        return { userId, organizationId, role: 'owner', email };
      }
    }
    return null;
  }

  return {
    userId,
    organizationId: member.organizationId,
    role: member.role,
    email: member.email || email,
  };
}

/** Check if a user has at least the required role level */
export function requireRole(ctx: IRequestContext, minRole: TeamRole): boolean {
  return ROLE_LEVEL[ctx.role] >= ROLE_LEVEL[minRole];
}

/**
 * Lazy migration for legacy single-user tenants.
 * If a tenant record exists where id === userId, auto-create an owner team member.
 */
async function lazyMigrate(userId: string, email: string): Promise<boolean> {
  const tenant = await ddb.getItem<{ id: string; organizationName?: string; adminEmail?: string }>(
    TENANTS_TABLE, { id: userId }
  );
  if (!tenant) return false;

  const now = new Date().toISOString();
  await ddb.putItem(TEAM_MEMBERS_TABLE, {
    PK: `ORG#${userId}`,
    SK: `USER#${userId}`,
    userId,
    organizationId: userId,
    role: 'owner',
    email: tenant.adminEmail || email || '',
    name: tenant.organizationName || 'Owner',
    mfaEnabled: false,
    invitedBy: 'system',
    joinedAt: now,
    updatedAt: now,
  });

  await audit.logAudit(userId, userId, 'team.auto_migrate', {
    reason: 'Legacy single-user tenant migrated to team model',
  }).catch(() => { /* non-critical */ });

  return true;
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

/**
 * Legacy helper — extracts tenant ID from JWT (Cognito sub).
 * @deprecated Use resolveRequestContext() instead
 */
export function getTenantId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext.authorizer.jwt.claims['sub'];
  return typeof sub === 'string' ? sub : '';
}
