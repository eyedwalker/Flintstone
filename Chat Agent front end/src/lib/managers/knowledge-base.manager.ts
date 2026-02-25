import { Injectable } from '@angular/core';
import { Subject, interval } from 'rxjs';
import { takeWhile, switchMap } from 'rxjs/operators';
import {
  IKnowledgeBaseContent,
  IUploadProgress,
  IUrlIngestionRequest,
  IIngestionJob,
  ContentScope,
} from '../models/knowledge-base.model';
import { IAccessorResult } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';
import { ContentIngestionEngine } from '../engines/content-ingestion.engine';

/**
 * Manager for knowledge base content ingestion pipeline.
 * All operations go through the secure API Gateway.
 */
@Injectable({ providedIn: 'root' })
export class KnowledgeBaseManager {
  constructor(
    private api: ApiService,
    private ingestionEngine: ContentIngestionEngine,
  ) {}

  /**
   * Full pipeline: get presigned URL → upload to S3 → trigger Bedrock sync.
   * Returns a progress Subject for real-time upload tracking.
   */
  ingestFile(
    file: File,
    assistantId: string,
    _tenantId: string,
    knowledgeBaseId: string,
    scope: ContentScope,
    tags: string[] = []
  ): { progressSubject: Subject<IUploadProgress>; promise: Promise<IAccessorResult<IKnowledgeBaseContent>> } {
    const progressSubject = new Subject<IUploadProgress>();
    const promise = this.runFileIngestionPipeline(
      file, assistantId, knowledgeBaseId, scope, tags, progressSubject
    );
    return { progressSubject, promise };
  }

  /** Ingest a URL (website, YouTube, Vimeo) into the knowledge base */
  async ingestUrl(
    request: IUrlIngestionRequest,
    assistantId: string,
    _tenantId: string,
    knowledgeBaseId: string,
    dataSourceId: string
  ): Promise<IAccessorResult<IKnowledgeBaseContent>> {
    return this.api.post<IKnowledgeBaseContent>('/knowledge-base/ingest-url', {
      url: request.url,
      title: request.title,
      scope: request.scope,
      assistantId,
      knowledgeBaseId,
      dataSourceId,
    });
  }

  /** List content for an assistant */
  async listContent(assistantId: string): Promise<IAccessorResult<IKnowledgeBaseContent[]>> {
    return this.api.get<IKnowledgeBaseContent[]>('/knowledge-base/content', { assistantId });
  }

  /** Delete a content item */
  async deleteContent(content: IKnowledgeBaseContent): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/knowledge-base/content/${content.id}`);
  }

  /** Poll ingestion job status every 5s until complete */
  pollIngestionJob(
    knowledgeBaseId: string,
    dataSourceId: string,
    jobId: string
  ): Subject<IIngestionJob> {
    const subject = new Subject<IIngestionJob>();

    interval(5000).pipe(
      switchMap(() =>
        this.api.get<IIngestionJob>(`/knowledge-base/jobs/${knowledgeBaseId}/${dataSourceId}/${jobId}`)
      ),
      takeWhile((result) => {
        const status = result.data?.status;
        return status === 'STARTING' || status === 'IN_PROGRESS';
      }, true)
    ).subscribe((result) => {
      if (result.data) subject.next(result.data);
      const terminal = ['COMPLETE', 'FAILED', 'STOPPED'];
      if (result.data && terminal.includes(result.data.status)) {
        subject.complete();
      }
    });

    return subject;
  }

  private async runFileIngestionPipeline(
    file: File,
    assistantId: string,
    knowledgeBaseId: string,
    scope: ContentScope,
    tags: string[],
    progressSubject: Subject<IUploadProgress>
  ): Promise<IAccessorResult<IKnowledgeBaseContent>> {
    const mimeType = file.type || 'application/octet-stream';

    // Step 1: get presigned upload URL + pre-create DDB record
    const urlRes = await this.api.post<{ uploadUrl: string; contentId: string; s3Key: string }>(
      '/knowledge-base/upload-url',
      { assistantId, fileName: file.name, mimeType, scope, tags, knowledgeBaseId }
    );
    if (!urlRes.success || !urlRes.data) {
      return { success: false, error: urlRes.error };
    }

    const { uploadUrl, contentId, s3Key } = urlRes.data;

    // Step 2: upload directly to S3 via XHR (enables progress tracking)
    try {
      await this.api.uploadToS3(uploadUrl, file, mimeType, (pct) => {
        progressSubject.next({
          contentId,
          fileName: file.name,
          progress: pct,
          status: pct < 100 ? 'uploading' : 'complete',
          bytesUploaded: Math.round((pct / 100) * file.size),
          totalBytes: file.size,
        });
      });
    } catch (e) {
      progressSubject.error(e);
      return { success: false, error: String(e) };
    }

    progressSubject.next({
      contentId,
      fileName: file.name,
      progress: 100,
      status: 'complete',
      bytesUploaded: file.size,
      totalBytes: file.size,
    });
    progressSubject.complete();

    // Step 3: trigger Bedrock KB sync (creates data source + starts ingestion job)
    const syncRes = await this.api.post<IKnowledgeBaseContent>('/knowledge-base/sync', {
      contentId,
      s3Key,
      assistantId,
      knowledgeBaseId,
      fileName: file.name,
    });

    return syncRes;
  }
}
