import { v4 as uuidv4 } from 'uuid';
import * as ddb from './dynamo';

const TABLE = process.env['AUDIT_LOG_TABLE'] ?? '';
const TTL_DAYS = 90;

/** Log an audit event for an organization */
export async function logAudit(
  organizationId: string,
  userId: string,
  action: string,
  details: Record<string, unknown>,
  ip?: string
): Promise<void> {
  const now = new Date();
  const item: Record<string, unknown> = {
    PK: `ORG#${organizationId}`,
    SK: `${now.toISOString()}#${uuidv4()}`,
    userId,
    action,
    details,
    ip: ip ?? '',
    ttl: Math.floor(now.getTime() / 1000) + TTL_DAYS * 86400,
    createdAt: now.toISOString(),
  };
  await ddb.putItem(TABLE, item);
}

/** Query audit log entries for an organization (most recent first) */
export async function getAuditLog(
  organizationId: string,
  limit = 50,
  startKey?: string
): Promise<{ items: Record<string, unknown>[]; lastKey?: string }> {
  const { ddb: docClient } = await import('./dynamo');
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');

  const params: Record<string, unknown> = {
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `ORG#${organizationId}` },
    ScanIndexForward: false, // newest first
    Limit: limit,
  };
  if (startKey) {
    (params as any).ExclusiveStartKey = { PK: `ORG#${organizationId}`, SK: startKey };
  }

  const res = await docClient.send(new QueryCommand(params as any));
  return {
    items: (res.Items ?? []) as Record<string, unknown>[],
    lastKey: res.LastEvaluatedKey?.['SK'] as string | undefined,
  };
}
