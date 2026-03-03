import { Injectable } from '@angular/core';
import { IAssistant, IAccessorResult, AssistantStatus } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';
import { ServiceCache } from '../../app/core/utils/cache.util';

export interface ICreateAssistantRequest {
  tenantId: string;
  name: string;
  description?: string;
}

/**
 * Manager for full assistant lifecycle.
 * All operations go through the secure API Gateway — no direct AWS SDK calls.
 */
@Injectable({ providedIn: 'root' })
export class AssistantManager {
  private cache = new ServiceCache(30_000); // 30s TTL

  constructor(private api: ApiService) {}

  async createAssistant(request: ICreateAssistantRequest): Promise<IAccessorResult<IAssistant>> {
    this.cache.invalidate('list');
    return this.api.post<IAssistant>('/assistants', {
      name: request.name,
      description: request.description,
    });
  }

  async getAssistant(id: string): Promise<IAccessorResult<IAssistant | null>> {
    return this.api.get<IAssistant | null>(`/assistants/${id}`);
  }

  async listAssistants(_tenantId?: string): Promise<IAccessorResult<IAssistant[]>> {
    return this.cache.get('list', () => this.api.get<IAssistant[]>('/assistants'));
  }

  async updateAssistant(id: string, updates: Partial<IAssistant>): Promise<IAccessorResult<void>> {
    this.cache.invalidate('list');
    return this.api.put<void>(`/assistants/${id}`, updates);
  }

  async setStatus(id: string, status: AssistantStatus): Promise<IAccessorResult<void>> {
    return this.api.put<void>(`/assistants/${id}`, { status });
  }

  async provisionBedrockResources(assistant: IAssistant): Promise<IAccessorResult<IAssistant>> {
    return this.api.post<IAssistant>(`/assistants/${assistant.id}/provision`);
  }

  async deleteAssistant(assistant: IAssistant): Promise<IAccessorResult<void>> {
    this.cache.invalidate('list');
    return this.api.delete<void>(`/assistants/${assistant.id}`);
  }

  async regenerateApiKey(id: string): Promise<IAccessorResult<string>> {
    const res = await this.api.post<{ apiKey: string }>(`/assistants/${id}/regenerate-key`);
    if (!res.success || !res.data) return { success: false, error: res.error };
    return { success: true, data: res.data.apiKey };
  }

  /** Upload a widget asset (icon image) and return the public S3 URL */
  async uploadWidgetAsset(
    assistantId: string, file: File,
  ): Promise<IAccessorResult<{ publicUrl: string }>> {
    const res = await this.api.post<{ uploadUrl: string; publicUrl: string }>(
      `/assistants/${assistantId}/upload-asset`,
      { fileName: file.name, contentType: file.type },
    );
    if (!res.success || !res.data) return { success: false, error: res.error };
    // Upload file directly to S3 via presigned URL
    try {
      const uploadRes = await fetch(res.data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!uploadRes.ok) return { success: false, error: `S3 upload failed (${uploadRes.status})` };
    } catch (e) {
      return { success: false, error: `Upload network error: ${String(e)}` };
    }
    return { success: true, data: { publicUrl: res.data.publicUrl } };
  }

  /** Generate widget CSS from a text/Figma design description using AI */
  async generateWidgetCss(
    assistantId: string, prompt: string, currentCss?: string,
  ): Promise<IAccessorResult<{ css: string }>> {
    return this.api.post<{ css: string }>(
      `/assistants/${assistantId}/generate-css`,
      { prompt, currentCss },
    );
  }

  /** Generate widget UI code (HTML + CSS) from text or image using AI */
  async generateWidgetUi(
    assistantId: string,
    component: 'launcher' | 'chat',
    prompt?: string,
    image?: string,
    currentCode?: string,
  ): Promise<IAccessorResult<{ html?: string; css: string }>> {
    return this.api.post<{ html?: string; css: string }>(
      `/assistants/${assistantId}/generate-ui`,
      { component, prompt, image, currentCode },
    );
  }
}
