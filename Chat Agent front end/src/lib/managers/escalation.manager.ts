import { Injectable } from '@angular/core';
import { IEscalationConfig, ITestConnectionResult } from '../models/escalation.model';
import { IAccessorResult } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';

@Injectable({ providedIn: 'root' })
export class EscalationManager {
  constructor(private api: ApiService) {}

  async getConfig(assistantId: string): Promise<IAccessorResult<IEscalationConfig | null>> {
    return this.api.get<IEscalationConfig | null>(`/escalation/config/${assistantId}`);
  }

  async saveConfig(assistantId: string, config: {
    enabled: boolean;
    salesforceInstanceUrl: string;
    salesforceConsumerKey: string;
    salesforceUsername: string;
    privateKey?: string;
    triggerMode: string;
    autoTriggers: { keywords: string[]; sentimentThreshold?: number; maxTurns?: number };
    caseDefaults: { priority: string; origin: string; status: string; recordTypeId?: string };
  }): Promise<IAccessorResult<IEscalationConfig>> {
    return this.api.put<IEscalationConfig>(`/escalation/config/${assistantId}`, config);
  }

  async deleteConfig(assistantId: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/escalation/config/${assistantId}`);
  }

  async testConnection(assistantId: string): Promise<IAccessorResult<ITestConnectionResult>> {
    return this.api.post<ITestConnectionResult>(`/escalation/test-connection/${assistantId}`);
  }
}
