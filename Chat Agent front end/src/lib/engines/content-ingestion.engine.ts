import { Injectable } from '@angular/core';
import { ContentType, IKnowledgeBaseContent, IVideoMetadata } from '../models/knowledge-base.model';

export interface IIngestionStrategy {
  type: ContentType;
  s3Key: string;
  requiresUrlFetch: boolean;
  videoMetadata?: IVideoMetadata;
  mimeType: string;
}

const MIME_TO_TYPE: Record<string, ContentType> = {
  'application/pdf': 'pdf',
  'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-excel': 'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-powerpoint': 'powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
  'text/plain': 'text',
  'text/csv': 'csv',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
};

const MAX_FILE_SIZES: Record<ContentType, number> = {
  pdf: 50 * 1024 * 1024,
  word: 50 * 1024 * 1024,
  excel: 25 * 1024 * 1024,
  powerpoint: 100 * 1024 * 1024,
  text: 10 * 1024 * 1024,
  csv: 25 * 1024 * 1024,
  image: 20 * 1024 * 1024,
  url: 0,
  website: 0,
  youtube: 0,
  vimeo: 0,
  custom: 200 * 1024 * 1024,
};

/**
 * Engine for determining content ingestion strategy per content type.
 * Stateless — pure classification and validation logic.
 */
@Injectable({ providedIn: 'root' })
export class ContentIngestionEngine {

  /** Classify a File into a ContentType */
  classifyFile(file: File): ContentType {
    const mimeType = file.type.toLowerCase();
    return MIME_TO_TYPE[mimeType] ?? 'custom';
  }

  /** Classify a URL string into a ContentType */
  classifyUrl(url: string): ContentType {
    const lower = url.toLowerCase();
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
    if (lower.includes('vimeo.com')) return 'vimeo';
    return 'url';
  }

  /** Build S3 key for a content item */
  buildS3Key(tenantId: string, assistantId: string, contentId: string, fileName: string): string {
    const ext = fileName.split('.').pop() ?? 'bin';
    const scope = 'tenant';
    return `${tenantId}/${assistantId}/${scope}/${contentId}.${ext}`;
  }

  /** Build S3 key for global (shared) content */
  buildGlobalS3Key(contentId: string, fileName: string): string {
    const ext = fileName.split('.').pop() ?? 'bin';
    return `global/${contentId}.${ext}`;
  }

  /** Validate a file before upload */
  validateFile(file: File): string[] {
    const errors: string[] = [];
    const type = this.classifyFile(file);

    if (file.size === 0) errors.push('File is empty');

    const maxSize = MAX_FILE_SIZES[type];
    if (maxSize > 0 && file.size > maxSize) {
      errors.push(`File too large. Maximum size: ${this.formatBytes(maxSize)}`);
    }

    if (!MIME_TO_TYPE[file.type] && !file.name.match(/\.(txt|csv|pdf|doc|docx|xls|xlsx|ppt|pptx|jpg|jpeg|png|gif|webp)$/i)) {
      errors.push('Unsupported file type');
    }

    return errors;
  }

  /** Validate a URL for ingestion */
  validateUrl(url: string): string[] {
    const errors: string[] = [];
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('URL must use HTTP or HTTPS');
      }
    } catch {
      errors.push('Invalid URL format');
    }
    return errors;
  }

  /** Extract video metadata from a YouTube or Vimeo URL */
  extractVideoMetadata(url: string): IVideoMetadata | null {
    const youtubeMatch = url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([^&\n?#]+)/
    );
    if (youtubeMatch) {
      const videoId = youtubeMatch[1];
      return {
        platform: 'youtube',
        videoId,
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        title: '',
      };
    }

    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
      return {
        platform: 'vimeo',
        videoId: vimeoMatch[1],
        thumbnailUrl: '',
        title: '',
      };
    }

    return null;
  }

  /** Check if content item is ready for the assistant */
  isContentReady(content: IKnowledgeBaseContent): boolean {
    return content.status === 'ready';
  }

  /** Human-readable file size */
  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Get display icon name for a content type */
  getContentTypeIcon(type: ContentType): string {
    const icons: Record<ContentType, string> = {
      pdf: 'picture_as_pdf',
      word: 'description',
      excel: 'table_chart',
      powerpoint: 'slideshow',
      text: 'text_snippet',
      csv: 'table_rows',
      url: 'link',
      website: 'language',
      youtube: 'smart_display',
      vimeo: 'play_circle',
      image: 'image',
      custom: 'insert_drive_file',
    };
    return icons[type] ?? 'insert_drive_file';
  }
}
