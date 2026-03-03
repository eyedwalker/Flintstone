import { Injectable } from '@angular/core';
import { IWidgetPreset, WidgetPresetConfig, IAccessorResult } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';
import { ServiceCache } from '../../app/core/utils/cache.util';

@Injectable({ providedIn: 'root' })
export class WidgetPresetManager {
  private cache = new ServiceCache(30_000);

  constructor(private api: ApiService) {}

  async listPresets(): Promise<IAccessorResult<IWidgetPreset[]>> {
    return this.cache.get('widget-presets', () =>
      this.api.get<IWidgetPreset[]>('/widget-presets')
    );
  }

  async createPreset(name: string, config: WidgetPresetConfig): Promise<IAccessorResult<IWidgetPreset>> {
    this.cache.invalidate('widget-presets');
    return this.api.post<IWidgetPreset>('/widget-presets', { name, ...config });
  }

  async updatePreset(id: string, updates: Partial<IWidgetPreset>): Promise<IAccessorResult<IWidgetPreset>> {
    this.cache.invalidate('widget-presets');
    return this.api.put<IWidgetPreset>(`/widget-presets/${id}`, updates);
  }

  async deletePreset(id: string): Promise<IAccessorResult<void>> {
    this.cache.invalidate('widget-presets');
    return this.api.delete<void>(`/widget-presets/${id}`);
  }
}
