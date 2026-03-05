export type TriggerMode = 'manual' | 'auto' | 'both';
export type AuthMode = 'jwt' | 'password';

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

export interface ICustomFieldMapping {
  enabled: boolean;
  fields: string[];
}

export interface IEscalationConfig {
  assistantId: string;
  tenantId: string;
  enabled: boolean;
  authMode: AuthMode;
  salesforceInstanceUrl: string;
  salesforceConsumerKey: string;
  salesforceUsername: string;
  hasPrivateKey: boolean;
  // Password flow
  salesforceLoginUrl?: string;
  salesforceClientId?: string;
  hasPasswordCredentials: boolean;
  triggerMode: TriggerMode;
  autoTriggers: IAutoTriggers;
  caseDefaults: ICaseDefaults;
  customFieldMapping?: ICustomFieldMapping;
  aiAnalysisEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ITestConnectionResult {
  success: boolean;
  instanceUrl?: string;
  customFields?: string[];
  error?: string;
}
