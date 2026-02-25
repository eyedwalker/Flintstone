import { Injectable } from '@angular/core';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IAccessorResult } from '../models/tenant.model';
import { IUploadProgress } from '../models/knowledge-base.model';
import { BaseAccessor } from './base.accessor';
import { environment } from '../../environments/environment';
import { Subject } from 'rxjs';

export interface IS3Object {
  key: string;
  size: number;
  lastModified: Date;
  eTag: string;
}

/**
 * Accessor for AWS S3 operations.
 * Uses multipart upload via lib-storage for large files.
 */
@Injectable({ providedIn: 'root' })
export class S3Accessor extends BaseAccessor {
  private readonly client = new S3Client({ region: environment.aws.region });
  private readonly bucket = environment.aws.s3ContentBucket;

  /** Upload a file to S3 with progress tracking via Subject */
  uploadFile(
    file: File,
    key: string,
    progressSubject: Subject<IUploadProgress>,
    contentId: string
  ): { upload: Upload; promise: Promise<IAccessorResult<string>> } {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: file.type,
        Metadata: { originalName: file.name, contentId },
      },
      queueSize: 4,
      partSize: 1024 * 1024 * 5,
    });

    upload.on('httpUploadProgress', (progress) => {
      progressSubject.next({
        contentId,
        fileName: file.name,
        progress: progress.total
          ? Math.round(((progress.loaded ?? 0) / progress.total) * 100)
          : 0,
        status: 'uploading',
        bytesUploaded: progress.loaded ?? 0,
        totalBytes: progress.total ?? file.size,
      });
    });

    const promise = this.execute(async () => {
      await upload.done();
      return `s3://${this.bucket}/${key}`;
    });

    return { upload, promise };
  }

  /** List all objects with a given prefix */
  async listObjects(prefix: string): Promise<IAccessorResult<IS3Object[]>> {
    return this.execute(async () => {
      const response = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix })
      );
      return (response.Contents ?? []).map((obj) => ({
        key: obj.Key ?? '',
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(),
        eTag: obj.ETag ?? '',
      }));
    });
  }

  /** Delete an object by key */
  async deleteObject(key: string): Promise<IAccessorResult<void>> {
    return this.execute(async () => {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    });
  }

  /** Get a presigned download URL (15 min expiry) */
  async getPresignedUrl(key: string): Promise<IAccessorResult<string>> {
    return this.execute(async () => {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      return getSignedUrl(this.client, command, { expiresIn: 900 });
    });
  }
}
