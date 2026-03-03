import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env['REGION'] ?? 'us-west-2' });
const BUCKET = process.env['S3_CONTENT_BUCKET'] ?? '';

/** Generate a presigned PUT URL so the browser can upload directly to S3 */
export async function getUploadUrl(key: string, contentType: string): Promise<string> {
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn: 300 }); // 5 minutes
}

/** Generate a presigned GET URL for temporary read access */
export async function getDownloadUrl(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 900 }); // 15 minutes
}

/** Delete an object from the content bucket */
export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/** Upload a JSON object directly to S3 (server-side, no presigned URL) */
export async function putJsonObject(key: string, data: unknown): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }));
}

/** Upload raw text/binary content directly to S3 */
export async function putObject(key: string, body: string | Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

/** Read a text object from S3 */
export async function getObject(key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return (await res.Body?.transformToString('utf-8')) ?? '';
}

/** List objects under a prefix */
export async function listObjects(prefix: string, maxKeys = 1000): Promise<{ key: string; size: number; lastModified: string }[]> {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: maxKeys }));
  return (res.Contents ?? []).map(o => ({
    key: o.Key ?? '',
    size: o.Size ?? 0,
    lastModified: o.LastModified?.toISOString() ?? '',
  }));
}
