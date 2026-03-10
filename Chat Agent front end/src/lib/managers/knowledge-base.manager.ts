import { Injectable } from '@angular/core';
import { Subject, interval } from 'rxjs';
import { takeWhile, switchMap } from 'rxjs/operators';
import {
  IKnowledgeBaseContent,
  IKnowledgeBaseDefinition,
  IAssistantKbLink,
  IUploadProgress,
  IUrlIngestionRequest,
  IIngestionJob,
  IContentPreview,
  IVimeoBrowseResult,
  IVimeoBulkResult,
  IVimeoFoldersResult,
  ContentScope,
  RoleLevelValue,
} from '../models/knowledge-base.model';
import { IAccessorResult } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';
import { ContentIngestionEngine } from '../engines/content-ingestion.engine';
import { ServiceCache } from '../../app/core/utils/cache.util';

/**
 * Manager for knowledge base content ingestion pipeline.
 * All operations go through the secure API Gateway.
 */
@Injectable({ providedIn: 'root' })
export class KnowledgeBaseManager {
  private cache = new ServiceCache(30_000); // 30s TTL

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
    tags: string[] = [],
    minRoleLevel: RoleLevelValue = 0,
    useBDA: boolean = false,
  ): { progressSubject: Subject<IUploadProgress>; promise: Promise<IAccessorResult<IKnowledgeBaseContent>> } {
    const progressSubject = new Subject<IUploadProgress>();
    const promise = this.runFileIngestionPipeline(
      file, assistantId, knowledgeBaseId, scope, tags, minRoleLevel, progressSubject, useBDA
    );
    return { progressSubject, promise };
  }

  /** Ingest a website URL into the knowledge base (creates a WEB crawler data source) */
  async ingestUrl(
    request: IUrlIngestionRequest,
    assistantId: string,
    _tenantId: string,
    knowledgeBaseId: string,
    useBDA: boolean = false,
  ): Promise<IAccessorResult<IKnowledgeBaseContent>> {
    return this.api.post<IKnowledgeBaseContent>('/knowledge-base/ingest-url', {
      url: request.url,
      title: request.title,
      scope: request.scope,
      minRoleLevel: request.minRoleLevel ?? 0,
      crawlDepth: request.crawlDepth ?? 1,
      assistantId,
      knowledgeBaseId,
      useBDA,
    });
  }

  /** Ingest a Vimeo or YouTube video (fetches transcript + AI summary, no video file stored) */
  async ingestVideo(
    url: string,
    assistantId: string,
    knowledgeBaseId: string,
    scope: ContentScope,
    minRoleLevel: RoleLevelValue = 0,
    useBDA: boolean = false,
    kbDefId?: string,
  ): Promise<IAccessorResult<IKnowledgeBaseContent>> {
    return this.api.post<IKnowledgeBaseContent>('/knowledge-base/ingest-video', {
      url,
      assistantId,
      knowledgeBaseId,
      scope,
      minRoleLevel,
      useBDA,
      kbDefId,
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

  /** Check status of processing items and return updated list */
  async checkStatus(assistantId: string): Promise<IAccessorResult<IKnowledgeBaseContent[]>> {
    return this.api.post<IKnowledgeBaseContent[]>('/knowledge-base/check-status', { assistantId });
  }

  /** Update content item metadata (title, tags, scope, minRoleLevel) */
  async updateContent(
    contentId: string,
    updates: { title?: string; tags?: string[]; scope?: string; minRoleLevel?: number },
  ): Promise<IAccessorResult<IKnowledgeBaseContent>> {
    return this.api.patch<IKnowledgeBaseContent>(`/knowledge-base/content/${contentId}`, updates);
  }

  /** Preview stored S3 content for a content item */
  async previewContent(contentId: string, offset = 0, limit = 20): Promise<IAccessorResult<IContentPreview>> {
    return this.api.get<IContentPreview>(`/knowledge-base/content/${contentId}/preview`, {
      offset: String(offset),
      limit: String(limit),
    });
  }

  /** Retry a failed ingestion */
  async retryIngestion(contentId: string): Promise<IAccessorResult<{ dataSourceId: string; ingestionJobId: string }>> {
    return this.api.post<{ dataSourceId: string; ingestionJobId: string }>(`/knowledge-base/content/${contentId}/retry`);
  }

  /** Bulk delete content items */
  async bulkDelete(ids: string[]): Promise<IAccessorResult<{ deleted: number; total: number }>> {
    return this.api.post<{ deleted: number; total: number }>('/knowledge-base/content/bulk-delete', { ids });
  }

  /** List Vimeo folders/projects */
  async listVimeoFolders(
    assistantId: string, kbDefId?: string,
  ): Promise<IAccessorResult<IVimeoFoldersResult>> {
    return this.api.post<IVimeoFoldersResult>('/knowledge-base/vimeo/folders', {
      assistantId, kbDefId,
    });
  }

  /** Browse Vimeo account videos */
  async browseVimeo(
    assistantId: string, page = 1, perPage = 25, query?: string, kbDefId?: string, folderId?: string,
  ): Promise<IAccessorResult<IVimeoBrowseResult>> {
    return this.api.post<IVimeoBrowseResult>('/knowledge-base/vimeo/browse', {
      assistantId, page, perPage, query, kbDefId, folderId,
    });
  }

  /** Bulk ingest selected Vimeo videos */
  async bulkIngestVimeo(
    assistantId: string, knowledgeBaseId: string, videoIds: string[],
    scope?: string, minRoleLevel?: number, useBDA?: boolean, kbDefId?: string,
  ): Promise<IAccessorResult<IVimeoBulkResult>> {
    return this.api.post<IVimeoBulkResult>('/knowledge-base/vimeo/bulk-ingest', {
      assistantId, knowledgeBaseId, videoIds, scope, minRoleLevel, useBDA, kbDefId,
    });
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

  // ── Knowledge Base Definitions (shared KB library) ───────────────────────

  /** List all KB definitions for the org */
  async listDefinitions(): Promise<IAccessorResult<IKnowledgeBaseDefinition[]>> {
    return this.cache.get('kb-defs', () => this.api.get<IKnowledgeBaseDefinition[]>('/knowledge-bases'));
  }

  /** Get a single KB definition */
  async getDefinition(id: string): Promise<IAccessorResult<IKnowledgeBaseDefinition>> {
    return this.api.get<IKnowledgeBaseDefinition>(`/knowledge-bases/${id}`);
  }

  /** Create a new KB definition */
  async createDefinition(data: { name: string; description?: string; isDefault?: boolean }): Promise<IAccessorResult<IKnowledgeBaseDefinition>> {
    return this.api.post<IKnowledgeBaseDefinition>('/knowledge-bases', data);
  }

  /** Update a KB definition */
  async updateDefinition(id: string, data: { name?: string; description?: string; vimeoAccessToken?: string; vimeoExcludeKeywords?: string[] }): Promise<IAccessorResult<IKnowledgeBaseDefinition>> {
    return this.api.put<IKnowledgeBaseDefinition>(`/knowledge-bases/${id}`, data);
  }

  /** Delete a KB definition */
  async deleteDefinition(id: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/knowledge-bases/${id}`);
  }

  /** Provision Bedrock resources for a KB definition */
  async provisionDefinition(id: string): Promise<IAccessorResult<{ success: boolean; bedrockKnowledgeBaseId: string }>> {
    return this.api.post<{ success: boolean; bedrockKnowledgeBaseId: string }>(`/knowledge-bases/${id}/provision`);
  }

  /** Set a KB as the org default */
  async setDefault(id: string): Promise<IAccessorResult<IKnowledgeBaseDefinition>> {
    return this.api.post<IKnowledgeBaseDefinition>(`/knowledge-bases/${id}/set-default`);
  }

  /** List content by Bedrock knowledgeBaseId (for KB detail view) */
  async listContentByKbId(knowledgeBaseId: string): Promise<IAccessorResult<IKnowledgeBaseContent[]>> {
    return this.api.get<IKnowledgeBaseContent[]>('/knowledge-base/content', { knowledgeBaseId });
  }

  // ── Assistant KB linking ─────────────────────────────────────────────────

  /** List KBs linked to an assistant */
  async listAssistantKbs(assistantId: string): Promise<IAccessorResult<IAssistantKbLink[]>> {
    return this.api.get<IAssistantKbLink[]>(`/assistants/${assistantId}/knowledge-bases`);
  }

  /** Link a KB to an assistant */
  async linkKbToAssistant(assistantId: string, knowledgeBaseId: string): Promise<IAccessorResult<IAssistantKbLink>> {
    return this.api.post<IAssistantKbLink>(`/assistants/${assistantId}/knowledge-bases`, { knowledgeBaseId });
  }

  /** Unlink a KB from an assistant */
  async unlinkKbFromAssistant(assistantId: string, knowledgeBaseId: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/assistants/${assistantId}/knowledge-bases/${knowledgeBaseId}`);
  }

  private async runFileIngestionPipeline(
    file: File,
    assistantId: string,
    knowledgeBaseId: string,
    scope: ContentScope,
    tags: string[],
    minRoleLevel: RoleLevelValue,
    progressSubject: Subject<IUploadProgress>,
    useBDA: boolean = false,
  ): Promise<IAccessorResult<IKnowledgeBaseContent>> {
    const mimeType = file.type || 'application/octet-stream';

    // Step 1: get presigned upload URL + pre-create DDB record
    const urlRes = await this.api.post<{ uploadUrl: string; contentId: string; s3Key: string }>(
      '/knowledge-base/upload-url',
      { assistantId, fileName: file.name, mimeType, scope, tags, knowledgeBaseId, minRoleLevel, fileSize: file.size }
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
      useBDA,
    });

    return syncRes;
  }
}
