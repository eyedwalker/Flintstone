import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { IAccessorResult } from '../../../lib/models/tenant.model';
import { environment } from '../../../environments/environment';

/**
 * Centralized HTTP client for all API Gateway calls.
 * Attaches the Cognito ID token as the Authorization header.
 * Replaces all direct AWS SDK calls (DynamoDB, S3, Bedrock) from the browser.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = environment.apiBaseUrl;

  constructor(private auth: AuthService) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': this.auth.idToken ?? '',
    };
  }

  async get<T>(path: string, query?: Record<string, string>): Promise<IAccessorResult<T>> {
    const url = query
      ? `${this.base}${path}?${new URLSearchParams(query).toString()}`
      : `${this.base}${path}`;
    try {
      const res = await fetch(url, { method: 'GET', headers: this.headers() });
      if (!res.ok) return { success: false, error: await res.text() };
      return { success: true, data: await res.json() as T };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async post<T>(path: string, body?: unknown): Promise<IAccessorResult<T>> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) return { success: false, error: await res.text() };
      const text = await res.text();
      return { success: true, data: (text ? JSON.parse(text) : null) as T };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async put<T>(path: string, body?: unknown): Promise<IAccessorResult<T>> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'PUT',
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) return { success: false, error: await res.text() };
      const text = await res.text();
      return { success: true, data: (text ? JSON.parse(text) : null) as T };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  async delete<T>(path: string): Promise<IAccessorResult<T>> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'DELETE',
        headers: this.headers(),
      });
      if (!res.ok) return { success: false, error: await res.text() };
      return { success: true, data: null as T };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  /**
   * Upload a file directly to S3 via a presigned PUT URL.
   * Emits progress via the provided callback.
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
