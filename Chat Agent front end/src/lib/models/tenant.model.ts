/** Subscription plan tiers */
export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise';

/** Subscription status from Stripe */
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';

/** Organization / Tenant (top-level account) */
export interface ITenant {
  id: string;
  organizationName: string;
  slug: string;
  logoUrl?: string;
  industry?: string;
  website?: string;
  adminEmail: string;
  cognitoUserId: string;
  plan: PlanTier;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus: SubscriptionStatus;
  usageCurrentMonth: IUsageCounters;
  limits: IPlanLimits;
  allowedDomains: string[];
  createdAt: string;
  updatedAt: string;
}

/** Per-tenant usage counters reset monthly */
export interface IUsageCounters {
  messages: number;
  storageBytes: number;
  videosIngested: number;
  apiCalls: number;
}

/** Plan feature limits */
export interface IPlanLimits {
  maxAssistants: number;
  maxMessagesPerMonth: number;
  maxStorageBytes: number;
  allowedModels: string[];
  allowSelfHosted: boolean;
  allowOtherProviders: boolean;
}

/** An individual AI assistant configuration under a tenant */
export interface IAssistant {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  status: AssistantStatus;
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
  bedrockKnowledgeBaseId?: string;
  bedrockGuardrailId?: string;
  bedrockGuardrailVersion?: string;
  modelConfig: IModelConfig;
  widgetConfig: IWidgetConfig;
  apiKey: string;
  allowedDomains: string[];
  createdAt: string;
  updatedAt: string;
}

export type AssistantStatus = 'draft' | 'provisioning' | 'ready' | 'error' | 'paused';

/** Accessor result wrapper — VBD standard */
export interface IAccessorResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

/** Model configuration stored on the Bedrock Agent */
export interface IModelConfig {
  provider: LLMProvider;
  modelId: string;
  modelName: string;
  systemPrompt: string;
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  stopSequences: string[];
  selfHostedEndpoint?: string;
}

export type LLMProvider = 'bedrock' | 'openai' | 'vertex' | 'azure' | 'selfhosted';

/** Widget visual and behavior configuration */
export interface IWidgetConfig {
  position: WidgetPosition;
  primaryColor: string;
  secondaryColor: string;
  title: string;
  welcomeMessage: string;
  placeholder: string;
  launcherIcon: string;
  showTimestamp: boolean;
  persistSession: boolean;
  enableStreaming: boolean;
  zIndex: number;
  trendingQuestions: string[];
  contextConfig: IContextConfig;
}

export type WidgetPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** Context injection configuration for the embed snippet */
export interface IContextConfig {
  passCurrentUrl: boolean;
  passUserId: boolean;
  userIdExpression: string;
  customFields: ICustomContextField[];
}

export interface ICustomContextField {
  key: string;
  expression: string;
}

/** Bedrock model catalog entry */
export interface IBedrockModel {
  modelId: string;
  modelName: string;
  provider: string;
  providerLabel: string;
  category: 'claude' | 'llama' | 'mistral' | 'titan' | 'nova' | 'cohere' | 'custom';
  contextWindow: number;
  supportsStreaming: boolean;
  inputPricePerToken: number;
  outputPricePerToken: number;
  planRequired: PlanTier;
}
