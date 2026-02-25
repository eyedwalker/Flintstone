/** Scope of content — global shared or tenant-specific */
export type ContentScope = 'global' | 'tenant';

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
export type ContentStatus = 'pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';

/** A single piece of ingested content */
export interface IKnowledgeBaseContent {
  id: string;
  assistantId: string;
  tenantId: string;
  scope: ContentScope;
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

/** Filter for listing content */
export interface IContentFilter {
  assistantId?: string;
  tenantId?: string;
  scope?: ContentScope;
  type?: ContentType;
  status?: ContentStatus;
  searchTerm?: string;
}
