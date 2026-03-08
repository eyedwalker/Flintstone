import { Injectable } from '@angular/core';
import { IScreenMapping, IGenerateMappingsResult } from '../models/screen-mapping.model';
import { IAccessorResult } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';

@Injectable({ providedIn: 'root' })
export class ScreenMappingManager {
  constructor(private api: ApiService) {}

  async listMappings(assistantId: string): Promise<IAccessorResult<IScreenMapping[]>> {
    return this.api.get<IScreenMapping[]>('/screen-mappings', { assistantId });
  }

  async getMapping(id: string): Promise<IAccessorResult<IScreenMapping>> {
    return this.api.get<IScreenMapping>(`/screen-mappings/${id}`);
  }

  async updateMapping(id: string, data: Partial<IScreenMapping>): Promise<IAccessorResult<IScreenMapping>> {
    return this.api.put<IScreenMapping>(`/screen-mappings/${id}`, data);
  }

  async deleteMapping(id: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/screen-mappings/${id}`);
  }

  async generateMappings(assistantId: string): Promise<IAccessorResult<IGenerateMappingsResult>> {
    return this.api.post<IGenerateMappingsResult>('/screen-mappings/generate', { assistantId });
  }
}
