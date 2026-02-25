/** Guardrail strength level */
export type FilterStrength = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

/** PII entity types Bedrock can detect and redact */
export type PIIEntityType =
  | 'ADDRESS'
  | 'AGE'
  | 'AWS_ACCESS_KEY'
  | 'AWS_SECRET_KEY'
  | 'CA_HEALTH_NUMBER'
  | 'CA_SOCIAL_INSURANCE_NUMBER'
  | 'CREDIT_DEBIT_CARD_CVV'
  | 'CREDIT_DEBIT_CARD_EXPIRY'
  | 'CREDIT_DEBIT_CARD_NUMBER'
  | 'DRIVER_ID'
  | 'EMAIL'
  | 'INTERNATIONAL_BANK_ACCOUNT_NUMBER'
  | 'IP_ADDRESS'
  | 'LICENSE_PLATE'
  | 'MAC_ADDRESS'
  | 'NAME'
  | 'PASSWORD'
  | 'PHONE'
  | 'PIN'
  | 'SWIFT_CODE'
  | 'UK_NATIONAL_HEALTH_SERVICE_NUMBER'
  | 'UK_NATIONAL_INSURANCE_NUMBER'
  | 'UK_UNIQUE_TAXPAYER_REFERENCE_NUMBER'
  | 'URL'
  | 'USERNAME'
  | 'US_BANK_ACCOUNT_NUMBER'
  | 'US_BANK_ROUTING_NUMBER'
  | 'US_INDIVIDUAL_TAX_IDENTIFICATION_NUMBER'
  | 'US_PASSPORT_NUMBER'
  | 'US_SOCIAL_SECURITY_NUMBER'
  | 'VEHICLE_IDENTIFICATION_NUMBER';

/** Full guardrail configuration */
export interface IGuardrailConfig {
  id: string;
  assistantId: string;
  name: string;
  description?: string;
  bedrockGuardrailId?: string;
  bedrockGuardrailVersion?: string;
  contentFilters: IContentFilter[];
  blockedTopics: IBlockedTopic[];
  wordFilters: IWordFilter[];
  piiConfig: IPIIConfig;
  groundingConfig: IGroundingConfig;
  blockedInputMessage: string;
  blockedOutputMessage: string;
  status: 'draft' | 'active' | 'updating';
  createdAt: string;
  updatedAt: string;
}

/** Content category filter (hate, violence, sexual, etc.) */
export interface IContentFilter {
  type: ContentFilterType;
  inputStrength: FilterStrength;
  outputStrength: FilterStrength;
}

export type ContentFilterType =
  | 'SEXUAL'
  | 'VIOLENCE'
  | 'HATE'
  | 'INSULTS'
  | 'MISCONDUCT'
  | 'PROMPT_ATTACK';

/** Topic the assistant should never discuss */
export interface IBlockedTopic {
  name: string;
  definition: string;
  examplePhrases: string[];
  type: 'DENY';
}

/** Word or phrase filter */
export interface IWordFilter {
  text: string;
  type: 'PROFANITY' | 'CUSTOM';
}

/** PII detection and redaction configuration */
export interface IPIIConfig {
  enabled: boolean;
  entities: IPIIEntity[];
}

export interface IPIIEntity {
  type: PIIEntityType;
  action: 'BLOCK' | 'ANONYMIZE';
}

/** Hallucination grounding configuration */
export interface IGroundingConfig {
  enabled: boolean;
  groundingThreshold: number;
  relevanceThreshold: number;
}

/** Guardrail test request/response */
export interface IGuardrailTestRequest {
  input: string;
  source: 'INPUT' | 'OUTPUT';
}

export interface IGuardrailTestResult {
  action: 'NONE' | 'GUARDRAIL_INTERVENED';
  assessments: IGuardrailAssessment[];
  output?: string;
}

export interface IGuardrailAssessment {
  topicPolicy?: { topics: Array<{ name: string; type: string; action: string }> };
  contentPolicy?: { filters: Array<{ type: string; confidence: string; action: string }> };
  wordPolicy?: { customWords: Array<{ match: string; action: string }> };
  sensitiveInformationPolicy?: { piiEntities: Array<{ type: string; action: string }> };
  groundingPolicy?: { groundingScore: number; relevanceScore: number; action: string };
}
