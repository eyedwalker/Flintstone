import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';

/** Create a fresh DynamoDB Document Client mock */
export function mockDynamoDB() {
  const mock = mockClient(DynamoDBDocumentClient);
  mock.on(GetCommand).resolves({ Item: undefined });
  mock.on(PutCommand).resolves({});
  mock.on(UpdateCommand).resolves({});
  mock.on(DeleteCommand).resolves({});
  mock.on(QueryCommand).resolves({ Items: [] });
  mock.on(ScanCommand).resolves({ Items: [] });
  return mock;
}

/** Create a fresh S3 Client mock */
export function mockS3() {
  return mockClient(S3Client);
}

/** Create a fresh SSM Client mock */
export function mockSSM() {
  const mock = mockClient(SSMClient);
  mock.on(GetParameterCommand).resolves({ Parameter: { Value: '' } });
  mock.on(PutParameterCommand).resolves({});
  mock.on(DeleteParameterCommand).resolves({});
  return mock;
}

// Re-export commands for convenient test assertions
export {
  GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand,
  GetObjectCommand, PutObjectCommand,
  GetParameterCommand, PutParameterCommand, DeleteParameterCommand,
};
