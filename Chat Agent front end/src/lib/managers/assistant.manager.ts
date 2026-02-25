import { Injectable } from '@angular/core';
import { IAssistant, IAccessorResult, AssistantStatus } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';

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
  constructor(private api: ApiService) {}

  async createAssistant(request: ICreateAssistantRequest): Promise<IAccessorResult<IAssistant>> {
    return this.api.post<IAssistant>('/assistants', {
      name: request.name,
      description: request.description,
    });
  }

  async getAssistant(id: string): Promise<IAccessorResult<IAssistant | null>> {
    return this.api.get<IAssistant | null>(`/assistants/${id}`);
  }

  async listAssistants(_tenantId: string): Promise<IAccessorResult<IAssistant[]>> {
    return this.api.get<IAssistant[]>('/assistants');
  }

  async updateAssistant(id: string, updates: Partial<IAssistant>): Promise<IAccessorResult<void>> {
    return this.api.put<void>(`/assistants/${id}`, updates);
  }

  async setStatus(id: string, status: AssistantStatus): Promise<IAccessorResult<void>> {
    return this.api.put<void>(`/assistants/${id}`, { status });
  }

  async provisionBedrockResources(assistant: IAssistant): Promise<IAccessorResult<IAssistant>> {
    return this.api.post<IAssistant>(`/assistants/${assistant.id}/provision`);
  }

  async deleteAssistant(assistant: IAssistant): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/assistants/${assistant.id}`);
  }

  async regenerateApiKey(id: string): Promise<IAccessorResult<string>> {
    const res = await this.api.post<{ apiKey: string }>(`/assistants/${id}/regenerate-key`);
    if (!res.success || !res.data) return { success: false, error: res.error };
    return { success: true, data: res.data.apiKey };
  }
}
