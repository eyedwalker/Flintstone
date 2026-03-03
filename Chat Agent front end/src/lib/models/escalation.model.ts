export type TriggerMode = 'manual' | 'auto' | 'both';

export interface IAutoTriggers {
  keywords: string[];
  sentimentThreshold?: number;
  maxTurns?: number;
}

export interface ICaseDefaults {
  priority: string;
  origin: string;
  status: string;
  recordTypeId?: string;
}

export interface IEscalationConfig {
  assistantId: string;
  tenantId: string;
  enabled: boolean;
  salesforceInstanceUrl: string;
  salesforceConsumerKey: string;
  salesforceUsername: string;
  hasPrivateKey: boolean;
  triggerMode: TriggerMode;
  autoTriggers: IAutoTriggers;
  caseDefaults: ICaseDefaults;
  createdAt: string;
  updatedAt: string;
}

export interface ITestConnectionResult {
  success: boolean;
  instanceUrl?: string;
  error?: string;
}
