import { Injectable } from '@angular/core';
import { IAccessorResult } from '../models/tenant.model';
import { IGuardrailConfig, IGuardrailTestResult } from '../models/guardrails.model';
import { ApiService } from '../../app/core/services/api.service';

export interface IGuardrailRef {
  guardrailId: string;
  guardrailArn: string;
  version: string;
  name: string;
  status: string;
}

/**
 * Accessor for Bedrock Guardrails — now calls API Gateway instead of SDK directly.
 */
@Injectable({ providedIn: 'root' })
export class BedrockGuardrailsAccessor {
  constructor(private api: ApiService) {}

  async createGuardrail(config: IGuardrailConfig): Promise<IAccessorResult<IGuardrailRef>> {
    return this.api.post<IGuardrailRef>('/guardrails', config);
  }

  async updateGuardrail(
    guardrailId: string, config: IGuardrailConfig
  ): Promise<IAccessorResult<IGuardrailRef>> {
    return this.api.put<IGuardrailRef>(`/guardrails/${guardrailId}`, config);
  }

  async testGuardrail(
    guardrailId: string,
    version: string,
    input: string,
    source: 'INPUT' | 'OUTPUT'
  ): Promise<IAccessorResult<IGuardrailTestResult>> {
    return this.api.post<IGuardrailTestResult>(`/guardrails/${guardrailId}/test`, {
      version, input, source,
    });
  }
}
