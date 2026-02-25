import { S3Client, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env['REGION'] ?? 'us-east-1' });
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
