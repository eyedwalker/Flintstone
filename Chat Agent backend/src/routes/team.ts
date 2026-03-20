import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import * as cognitoAdmin from '../services/cognito-admin';
import * as audit from '../services/audit';
import { ok, created, noContent, badRequest, forbidden, notFound, serverError } from '../response';
import { IRequestContext, ITeamMember, TeamRole, ROLE_LEVEL, requireRole, parseBody } from '../auth';

const TEAM_TABLE = process.env['TEAM_MEMBERS_TABLE'] ?? '';

export async function handleTeam(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  ctx: IRequestContext,
  sourceIp: string
): Promise<APIGatewayProxyResultV2> {
  try {
    const orgId = ctx.organizationId;

    // GET /team/my-orgs — any authenticated user
    if (method === 'GET' && path.endsWith('/my-orgs')) {
      const memberships = await ddb.queryItems<ITeamMember>(
        TEAM_TABLE,
        'userId = :u',
        { ':u': ctx.userId },
        undefined,
        'userId-index'
      );

      // Resolve organization names from tenants table
      const tenantsTable = process.env['TENANTS_TABLE'] ?? '';
      const results = await Promise.all(memberships.map(async (m) => {
        let organizationName = m.organizationId;
        if (tenantsTable) {
          const tenant = await ddb.getItem<{ id: string; organizationName?: string }>(
            tenantsTable, { id: m.organizationId }
          );
          if (tenant?.organizationName) organizationName = tenant.organizationName;
        }
        return {
          organizationId: m.organizationId,
          organizationName,
          role: m.role,
        };
      }));
      return ok(results);
    }

    // GET /team/members — admin+
    if (method === 'GET' && path.endsWith('/members')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const members = await ddb.queryItems<ITeamMember>(
        TEAM_TABLE,
        'PK = :pk',
        { ':pk': `ORG#${orgId}` },
      );

      // Enrich with Cognito status (parallel lookups)
      const enriched = await Promise.all(members.map(async (m) => {
        let cognitoStatus = 'UNKNOWN';
        let lastLogin: string | undefined;
        try {
          const status = await cognitoAdmin.getUserStatus(m.email);
          if (status) {
            cognitoStatus = status.status;
            lastLogin = status.lastLogin;
          }
        } catch { /* non-critical */ }

        return {
          userId: m.userId,
          role: m.role,
          email: m.email,
          name: m.name,
          mfaEnabled: m.mfaEnabled ?? false,
          invitedBy: m.invitedBy,
          joinedAt: m.joinedAt,
          cognitoStatus,
          lastLogin,
        };
      }));

      return ok(enriched);
    }

    // POST /team/invite — admin+
    if (method === 'POST' && path.endsWith('/invite')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');

      const b = parseBody<{ email: string; name: string; role: TeamRole }>(JSON.stringify(body));
      if (!b?.email || !b?.name || !b?.role) return badRequest('email, name, role required');

      // Only owners can invite with owner role
      if (b.role === 'owner' && !requireRole(ctx, 'owner')) {
        return forbidden('Only owners can invite with owner role');
      }

      // Validate role
      if (ROLE_LEVEL[b.role] === undefined) return badRequest('Invalid role');

      // Check if user already exists in Cognito
      let userId: string;
      const existingUser = await cognitoAdmin.findUserByEmail(b.email);

      if (existingUser) {
        userId = existingUser.userId;
        // Check if already a member of this org
        const existing = await ddb.getItem<ITeamMember>(
          TEAM_TABLE, { PK: `ORG#${orgId}`, SK: `USER#${userId}` }
        );
        if (existing) return badRequest('User is already a member of this organization');
      } else {
        // Create new Cognito user
        const result = await cognitoAdmin.createUser(b.email, b.name);
        userId = result.userId;
      }

      // Create team member record
      const now = new Date().toISOString();
      await ddb.putItem(TEAM_TABLE, {
        PK: `ORG#${orgId}`,
        SK: `USER#${userId}`,
        userId,
        organizationId: orgId,
        role: b.role,
        email: b.email,
        name: b.name,
        mfaEnabled: false,
        invitedBy: ctx.userId,
        joinedAt: now,
        updatedAt: now,
      });

      await audit.logAudit(orgId, ctx.userId, 'team.invite', {
        targetEmail: b.email, targetUserId: userId, role: b.role,
      }, sourceIp);

      return created({ userId, email: b.email, name: b.name, role: b.role });
    }

    // PUT /team/members/:userId/role — admin+
    if (method === 'PUT' && path.includes('/members/') && path.endsWith('/role')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');

      const targetUserId = path.split('/').slice(-2)[0]; // extract userId from path
      const b = parseBody<{ role: TeamRole }>(JSON.stringify(body));
      if (!b?.role || ROLE_LEVEL[b.role] === undefined) return badRequest('Valid role required');

      // Only owners can promote to owner or change owner roles
      if (b.role === 'owner' && !requireRole(ctx, 'owner')) {
        return forbidden('Only owners can assign owner role');
      }

      const target = await ddb.getItem<ITeamMember>(
        TEAM_TABLE, { PK: `ORG#${orgId}`, SK: `USER#${targetUserId}` }
      );
      if (!target) return notFound('Member not found');

      // Non-owners cannot modify owners
      if (target.role === 'owner' && !requireRole(ctx, 'owner')) {
        return forbidden('Only owners can modify other owners');
      }

      // Self-demotion protection: owners cannot demote themselves if they're the last owner
      if (ctx.userId === targetUserId && ctx.role === 'owner' && b.role !== 'owner') {
        const ownerCount = await countOwnersInOrg(orgId);
        if (ownerCount <= 1) return badRequest('Cannot demote the last owner. Transfer ownership first.');
      }

      const oldRole = target.role;
      await ddb.updateItem(TEAM_TABLE,
        { PK: `ORG#${orgId}`, SK: `USER#${targetUserId}` },
        { role: b.role, updatedAt: new Date().toISOString() }
      );

      await audit.logAudit(orgId, ctx.userId, 'team.role_change', {
        targetUserId, oldRole, newRole: b.role,
      }, sourceIp);

      return ok({ success: true, oldRole, newRole: b.role });
    }

    // DELETE /team/members/:userId — admin+
    if (method === 'DELETE' && path.includes('/members/')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');

      const targetUserId = path.split('/').pop()!;

      // Cannot remove yourself
      if (targetUserId === ctx.userId) {
        return badRequest('Cannot remove yourself. Ask another admin or transfer ownership first.');
      }

      const target = await ddb.getItem<ITeamMember>(
        TEAM_TABLE, { PK: `ORG#${orgId}`, SK: `USER#${targetUserId}` }
      );
      if (!target) return notFound('Member not found');

      // Only owners can remove other owners
      if (target.role === 'owner' && !requireRole(ctx, 'owner')) {
        return forbidden('Only owners can remove other owners');
      }

      // Last owner protection
      if (target.role === 'owner') {
        const ownerCount = await countOwnersInOrg(orgId);
        if (ownerCount <= 1) return badRequest('Cannot remove the last owner');
      }

      await ddb.deleteItem(TEAM_TABLE, { PK: `ORG#${orgId}`, SK: `USER#${targetUserId}` });

      await audit.logAudit(orgId, ctx.userId, 'team.remove', {
        targetUserId, targetEmail: target.email, targetRole: target.role,
      }, sourceIp);

      return noContent();
    }

    // POST /team/members/:userId/reset-password — admin+
    if (method === 'POST' && path.includes('/members/') && path.endsWith('/reset-password')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');

      const targetUserId = path.split('/').slice(-2)[0];
      const target = await ddb.getItem<ITeamMember>(
        TEAM_TABLE, { PK: `ORG#${orgId}`, SK: `USER#${targetUserId}` }
      );
      if (!target) return notFound('Member not found');

      // Only owners can reset other owners
      if (target.role === 'owner' && !requireRole(ctx, 'owner')) {
        return forbidden('Only owners can reset owner passwords');
      }

      await cognitoAdmin.resetUserPassword(target.email);

      await audit.logAudit(orgId, ctx.userId, 'team.reset_password', {
        targetUserId, targetEmail: target.email,
      }, sourceIp);

      return ok({ success: true, message: `Password reset email sent to ${target.email}` });
    }

    // POST /team/members/:userId/resend-invite — admin+
    if (method === 'POST' && path.includes('/members/') && path.endsWith('/resend-invite')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');

      const targetUserId = path.split('/').slice(-2)[0];
      const target = await ddb.getItem<ITeamMember>(
        TEAM_TABLE, { PK: `ORG#${orgId}`, SK: `USER#${targetUserId}` }
      );
      if (!target) return notFound('Member not found');

      const result = await cognitoAdmin.resendInvite(target.email, target.name);

      // Update the userId in team member record (new Cognito user has new sub)
      const newUser = await cognitoAdmin.findUserByEmail(target.email);
      if (newUser && newUser.userId !== targetUserId) {
        // Delete old record, create new one with updated userId
        await ddb.deleteItem(TEAM_TABLE, { PK: `ORG#${orgId}`, SK: `USER#${targetUserId}` });
        await ddb.putItem(TEAM_TABLE, {
          PK: `ORG#${orgId}`,
          SK: `USER#${newUser.userId}`,
          userId: newUser.userId,
          organizationId: orgId,
          role: target.role,
          email: target.email,
          name: target.name,
          mfaEnabled: false,
          invitedBy: ctx.userId,
          joinedAt: target.joinedAt,
          updatedAt: new Date().toISOString(),
        });
      }

      await audit.logAudit(orgId, ctx.userId, 'team.resend_invite', {
        targetEmail: target.email,
      }, sourceIp);

      return ok({ success: true, message: `Invite resent to ${target.email}` });
    }

    // POST /team/transfer-ownership — owner only
    if (method === 'POST' && path.endsWith('/transfer-ownership')) {
      if (!requireRole(ctx, 'owner')) return forbidden('Owner role required');

      const b = parseBody<{ targetUserId: string; password: string }>(JSON.stringify(body));
      if (!b?.targetUserId || !b?.password) return badRequest('targetUserId and password required');

      // Re-authenticate
      const verified = await cognitoAdmin.verifyPassword(ctx.email, b.password);
      if (!verified) return forbidden('Invalid password');

      const target = await ddb.getItem<ITeamMember>(
        TEAM_TABLE, { PK: `ORG#${orgId}`, SK: `USER#${b.targetUserId}` }
      );
      if (!target) return notFound('Target member not found');

      // Atomic ownership transfer using DynamoDB transactions
      const { ddb: docClient } = await import('../services/dynamo');
      const { TransactWriteCommand } = await import('@aws-sdk/lib-dynamodb');

      await docClient.send(new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TEAM_TABLE,
              Key: { PK: `ORG#${orgId}`, SK: `USER#${b.targetUserId}` },
              UpdateExpression: 'SET #r = :owner, updatedAt = :now',
              ExpressionAttributeNames: { '#r': 'role' },
              ExpressionAttributeValues: { ':owner': 'owner', ':now': new Date().toISOString() },
            },
          },
          {
            Update: {
              TableName: TEAM_TABLE,
              Key: { PK: `ORG#${orgId}`, SK: `USER#${ctx.userId}` },
              UpdateExpression: 'SET #r = :admin, updatedAt = :now',
              ExpressionAttributeNames: { '#r': 'role' },
              ExpressionAttributeValues: { ':admin': 'admin', ':now': new Date().toISOString() },
            },
          },
        ],
      }));

      await audit.logAudit(orgId, ctx.userId, 'owner.transfer', {
        fromUserId: ctx.userId, toUserId: b.targetUserId,
      }, sourceIp);

      return ok({ success: true, message: 'Ownership transferred' });
    }

    // GET /team/audit-log — owner only
    if (method === 'GET' && path.endsWith('/audit-log')) {
      if (!requireRole(ctx, 'owner')) return forbidden('Owner role required');
      const limit = parseInt(query['limit'] ?? '50', 10);
      const startKey = query['startKey'];
      const result = await audit.getAuditLog(orgId, limit, startKey);
      return ok(result);
    }

    // POST /team/mfa/setup — any authenticated user
    if (method === 'POST' && path.endsWith('/mfa/setup')) {
      // Requires the user's access token to be passed
      const b = parseBody<{ accessToken: string }>(JSON.stringify(body));
      if (!b?.accessToken) return badRequest('accessToken required');
      const result = await cognitoAdmin.setupMfa(b.accessToken);
      return ok(result);
    }

    // POST /team/mfa/verify — any authenticated user
    if (method === 'POST' && path.endsWith('/mfa/verify')) {
      const b = parseBody<{ accessToken: string; totpCode: string }>(JSON.stringify(body));
      if (!b?.accessToken || !b?.totpCode) return badRequest('accessToken and totpCode required');

      const success = await cognitoAdmin.verifyMfa(b.accessToken, b.totpCode);
      if (!success) return badRequest('Invalid TOTP code');

      // Enable MFA preference
      await cognitoAdmin.setMfaPreference(ctx.email, true);

      // Update team member record
      await ddb.updateItem(TEAM_TABLE,
        { PK: `ORG#${orgId}`, SK: `USER#${ctx.userId}` },
        { mfaEnabled: true, updatedAt: new Date().toISOString() }
      );

      await audit.logAudit(orgId, ctx.userId, 'mfa.enabled', {}, sourceIp);

      return ok({ success: true });
    }

    // POST /team/mfa/disable — owner only + re-auth
    if (method === 'POST' && path.endsWith('/mfa/disable')) {
      if (!requireRole(ctx, 'owner')) return forbidden('Owner role required');

      const b = parseBody<{ password: string }>(JSON.stringify(body));
      if (!b?.password) return badRequest('password required');

      const verified = await cognitoAdmin.verifyPassword(ctx.email, b.password);
      if (!verified) return forbidden('Invalid password');

      await cognitoAdmin.setMfaPreference(ctx.email, false);

      await ddb.updateItem(TEAM_TABLE,
        { PK: `ORG#${orgId}`, SK: `USER#${ctx.userId}` },
        { mfaEnabled: false, updatedAt: new Date().toISOString() }
      );

      await audit.logAudit(orgId, ctx.userId, 'mfa.disabled', {}, sourceIp);

      return ok({ success: true });
    }

    return notFound();
  } catch (e) {
    console.error('team handler error', e);
    return serverError(String(e));
  }
}

/** Count owners in an organization */
async function countOwnersInOrg(orgId: string): Promise<number> {
  const members = await ddb.queryItems<ITeamMember>(
    TEAM_TABLE, 'PK = :pk', { ':pk': `ORG#${orgId}` }
  );
  return members.filter(m => m.role === 'owner').length;
}
