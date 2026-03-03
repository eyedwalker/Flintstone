import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { IAccessorResult } from '../../../lib/models/tenant.model';
import { environment } from '../../../environments/environment';

/**
 * Centralized HTTP client for all API Gateway calls.
 * Auth headers (Authorization, X-Organization-Id) are now
 * attached automatically by the AuthInterceptor.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  async get<T>(path: string, query?: Record<string, string>): Promise<IAccessorResult<T>> {
    try {
      const params = query ? new HttpParams({ fromObject: query }) : undefined;
      const data = await firstValueFrom(
        this.http.get<T>(`${this.baseUrl}${path}`, { params }),
      );
      return { success: true, data };
    } catch (e: any) {
      const message = e?.error?.error ?? e?.error?.message ?? e?.message ?? String(e);
      return { success: false, error: message };
    }
  }

  async post<T>(path: string, body?: unknown): Promise<IAccessorResult<T>> {
    try {
      const data = await firstValueFrom(
        this.http.post<T>(`${this.baseUrl}${path}`, body ?? null),
      );
      return { success: true, data: data ?? (null as T) };
    } catch (e: any) {
      const message = e?.error?.error ?? e?.error?.message ?? e?.message ?? String(e);
      return { success: false, error: message };
    }
  }

  async put<T>(path: string, body?: unknown): Promise<IAccessorResult<T>> {
    try {
      const data = await firstValueFrom(
        this.http.put<T>(`${this.baseUrl}${path}`, body ?? null),
      );
      return { success: true, data: data ?? (null as T) };
    } catch (e: any) {
      const message = e?.error?.error ?? e?.error?.message ?? e?.message ?? String(e);
      return { success: false, error: message };
    }
  }

  async patch<T>(path: string, body?: unknown): Promise<IAccessorResult<T>> {
    try {
      const data = await firstValueFrom(
        this.http.patch<T>(`${this.baseUrl}${path}`, body ?? null),
      );
      return { success: true, data: data ?? (null as T) };
    } catch (e: any) {
      const message = e?.error?.error ?? e?.error?.message ?? e?.message ?? String(e);
      return { success: false, error: message };
    }
  }

  async delete<T>(path: string): Promise<IAccessorResult<T>> {
    try {
      await firstValueFrom(
        this.http.delete(`${this.baseUrl}${path}`),
      );
      return { success: true, data: null as T };
    } catch (e: any) {
      const message = e?.error?.error ?? e?.error?.message ?? e?.message ?? String(e);
      return { success: false, error: message };
    }
  }

  /**
   * Upload a file directly to S3 via a presigned PUT URL.
   * Emits progress via the provided callback.
   * Kept as raw XHR — S3 presigned URLs should NOT go through our interceptor.
   */
  uploadToS3(
    presignedUrl: string,
    file: File,
    contentType: string,
    onProgress: (pct: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`S3 upload failed: ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('S3 upload network error'));
      xhr.send(file);
    });
  }
}
