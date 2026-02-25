import { Injectable } from '@angular/core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { IAccessorResult } from '../models/tenant.model';
import { BaseAccessor } from './base.accessor';
import { environment } from '../../environments/environment';

/**
 * Accessor for DynamoDB document operations.
 * Used for storing tenant, assistant, content, and metrics records.
 */
@Injectable({ providedIn: 'root' })
export class DynamoDBAccessor extends BaseAccessor {
  private readonly docClient: DynamoDBDocumentClient;

  constructor() {
    super();
    const raw = new DynamoDBClient({ region: environment.aws.region });
    this.docClient = DynamoDBDocumentClient.from(raw, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /** Put (upsert) an item into a table */
  async putItem(
    tableName: string, item: object
  ): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.docClient.send(new PutCommand({ TableName: tableName, Item: item as Record<string, unknown> }));
    });
  }

  /** Get a single item by primary key */
  async getItem<T>(
    tableName: string,
    key: Record<string, string | number>
  ): Promise<IAccessorResult<T | null>> {
    return this.execute(async () => {
      const response = await this.docClient.send(
        new GetCommand({ TableName: tableName, Key: key })
      );
      return (response.Item as T) ?? null;
    });
  }

  /** Update specific fields on an item */
  async updateItem(
    tableName: string,
    key: Record<string, string | number>,
    updates: Record<string, unknown>
  ): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      const updateParts: string[] = [];
      const expressionValues: Record<string, unknown> = {};
      const expressionNames: Record<string, string> = {};

      Object.entries(updates).forEach(([field, value], i) => {
        const placeholder = `:val${i}`;
        const namePlaceholder = `#field${i}`;
        updateParts.push(`${namePlaceholder} = ${placeholder}`);
        expressionValues[placeholder] = value;
        expressionNames[namePlaceholder] = field;
      });

      await this.docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeValues: expressionValues,
        ExpressionAttributeNames: expressionNames,
      }));
    });
  }

  /** Delete an item */
  async deleteItem(
    tableName: string,
    key: Record<string, string | number>
  ): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.docClient.send(new DeleteCommand({ TableName: tableName, Key: key }));
    });
  }

  /** Query items by partition key (with optional filter) */
  async query<T>(
    tableName: string,
    keyCondition: string,
    expressionValues: Record<string, unknown>,
    expressionNames?: Record<string, string>,
    indexName?: string
  ): Promise<IAccessorResult<T[]>> {
    return this.execute(async () => {
      const response = await this.docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: expressionValues,
        ExpressionAttributeNames: expressionNames,
      }));
      return (response.Items ?? []) as T[];
    });
  }

  /** Scan a table with optional filter */
  async scan<T>(
    tableName: string,
    filterExpression?: string,
    expressionValues?: Record<string, unknown>
  ): Promise<IAccessorResult<T[]>> {
    return this.execute(async () => {
      const response = await this.docClient.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionValues,
      }));
      return (response.Items ?? []) as T[];
    });
  }
}
