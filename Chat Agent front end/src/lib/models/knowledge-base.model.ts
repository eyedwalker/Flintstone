/** Scope of content — global shared or tenant-specific */
export type ContentScope = 'global' | 'tenant';

/**
 * Role access levels for knowledge base content.
 * Higher value = more restricted. A user at level N can read all content at levels 0–N.
 */
export const ROLE_ACCESS_LEVELS = [
  { value: 0, label: 'Everyone',      description: 'No restriction — all users including unauthenticated' },
  { value: 1, label: 'Authenticated', description: 'Any logged-in user' },
  { value: 2, label: 'Staff+',        description: 'Practice staff, doctors, and admins' },
  { value: 3, label: 'Doctor+',       description: 'Doctors and admins only' },
  { value: 4, label: 'Admin only',    description: 'Practice or regional admins only' },
] as const;

export type RoleLevelValue = 0 | 1 | 2 | 3 | 4;

/** Type of content being ingested */
export type ContentType =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'text'
  | 'csv'
  | 'url'
  | 'website'
  | 'youtube'
  | 'vimeo'
  | 'image'
  | 'custom';

/** Status of a knowledge base content item */
export type ContentStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'error' | 'deleted';

/** A single piece of ingested content */
export interface IKnowledgeBaseContent {
  id: string;
  assistantId: string;
  tenantId: string;
  scope: ContentScope;
  /** Minimum role level required to retrieve this content (0 = public, 4 = admin only) */
  minRoleLevel: RoleLevelValue;
  type: ContentType;
  title: string;
  description?: string;
  s3Key?: string;
  s3Bucket?: string;
  sourceUrl?: string;
  fileSize?: number;
  mimeType?: string;
  status: ContentStatus;
  bedrockDataSourceId?: string;
  ingestionJobId?: string;
  bdaEnabled?: boolean;
  crawlProgress?: ICrawlProgress;
  errorMessage?: string;
  tags: string[];
  videoMetadata?: IVideoMetadata;
  createdAt: string;
  updatedAt: string;
}

/** Metadata for video content items */
export interface IVideoMetadata {
  platform: 'youtube' | 'vimeo' | 'other';
  videoId: string;
  thumbnailUrl: string;
  duration?: number;
  title?: string;
  description?: string;
}

/** Crawl progress for URL ingestion */
export interface ICrawlProgress {
  phase: 'crawling' | 'uploading' | 'ingesting';
  pagesCrawled: number;
  pagesQueued?: number;
  pagesUploaded?: number;
}

/** Preview of S3-stored content for a content item */
export interface IContentPreview {
  files: IPreviewFile[];
  totalFiles: number;
  offset?: number;
  limit?: number;
}

export interface IPreviewFile {
  key: string;
  size: number;
  text: string;
  truncated?: boolean;
  fullSize?: number;
  error?: string;
}

/** Upload progress tracker */
export interface IUploadProgress {
  contentId: string;
  fileName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  error?: string;
  bytesUploaded: number;
  totalBytes: number;
}

/** URL ingestion request */
export interface IUrlIngestionRequest {
  url: string;
  scope: ContentScope;
  minRoleLevel?: RoleLevelValue;
  title?: string;
  crawlDepth?: number;
  includePaths?: string[];
  excludePaths?: string[];
}

/** Bedrock Knowledge Base sync job status */
export interface IIngestionJob {
  jobId: string;
  knowledgeBaseId: string;
  dataSourceId: string;
  status: 'STARTING' | 'IN_PROGRESS' | 'STOPPING' | 'STOPPED' | 'COMPLETE' | 'FAILED';
  statistics?: {
    numberOfDocumentsScanned: number;
    numberOfDocumentsDeleted: number;
    numberOfDocumentsFailed: number;
    numberOfNewDocumentsIndexed: number;
    numberOfModifiedDocumentsIndexed: number;
  };
  startedAt: string;
  updatedAt: string;
}

/** A Vimeo video from the account browse endpoint */
export interface IVimeoVideoItem {
  videoId: string;
  name: string;
  description: string;
  duration: number;
  thumbnailUrl: string;
  link: string;
  createdTime: string;
  alreadyImported: boolean;
}

/** Result from browsing the Vimeo account */
export interface IVimeoBrowseResult {
  videos: IVimeoVideoItem[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
}

/** Result from bulk Vimeo video ingestion */
export interface IVimeoBulkResult {
  results: { videoId: string; contentId?: string; error?: string }[];
  total: number;
  succeeded: number;
}

/** Filter for listing content */
export interface IContentFilter {
  assistantId?: string;
  tenantId?: string;
  scope?: ContentScope;
  type?: ContentType;
  status?: ContentStatus;
  searchTerm?: string;
}

// ── Knowledge Base Definitions (shared KB library) ──────────────────────────

export type KbDefStatus = 'draft' | 'provisioning' | 'ready' | 'error';

/** A reusable knowledge base definition that can be linked to multiple assistants */
export interface IKnowledgeBaseDefinition {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  bedrockKnowledgeBaseId?: string;
  vectorBucketName?: string;
  vectorIndexName?: string;
  status: KbDefStatus;
  contentCount?: number;
  linkedAssistantCount?: number;
  linkedAssistantIds?: string[];
  createdAt: string;
  updatedAt: string;
}

/** A link between an assistant and a knowledge base definition */
export interface IAssistantKbLink {
  assistantId: string;
  knowledgeBaseId: string;
  tenantId: string;
  linkedAt: string;
  knowledgeBase?: IKnowledgeBaseDefinition | null;
}
