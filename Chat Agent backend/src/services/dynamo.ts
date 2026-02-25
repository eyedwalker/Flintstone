import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env['REGION'] ?? 'us-east-1' });
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export async function getItem<T>(table: string, key: Record<string, string>): Promise<T | null> {
  const res = await ddb.send(new GetCommand({ TableName: table, Key: key }));
  return (res.Item as T) ?? null;
}

export async function putItem(table: string, item: Record<string, unknown>): Promise<void> {
  await ddb.send(new PutCommand({ TableName: table, Item: item }));
}

export async function updateItem(
  table: string,
  key: Record<string, string>,
  updates: Record<string, unknown>
): Promise<void> {
  const entries = Object.entries(updates);
  if (!entries.length) return;
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const parts: string[] = [];
  entries.forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    parts.push(`#f${i} = :v${i}`);
  });
  await ddb.send(new UpdateCommand({
    TableName: table,
    Key: key,
    UpdateExpression: `SET ${parts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

export async function deleteItem(table: string, key: Record<string, string>): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: table, Key: key }));
}

export async function queryItems<T>(
  table: string,
  keyCondition: string,
  values: Record<string, unknown>,
  names?: Record<string, string>,
  indexName?: string
): Promise<T[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: table,
    IndexName: indexName,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: values,
    ExpressionAttributeNames: names,
  }));
  return (res.Items ?? []) as T[];
}

export async function scanItems<T>(
  table: string,
  filter?: string,
  values?: Record<string, unknown>
): Promise<T[]> {
  const res = await ddb.send(new ScanCommand({
    TableName: table,
    FilterExpression: filter,
    ExpressionAttributeValues: values,
  }));
  return (res.Items ?? []) as T[];
}
