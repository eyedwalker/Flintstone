/** Team role hierarchy */
export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';

export const ROLE_LEVEL: Record<TeamRole, number> = {
  owner: 4, admin: 3, editor: 2, viewer: 1,
};

/** Team member record */
export interface ITeamMember {
  userId: string;
  organizationId: string;
  role: TeamRole;
  email: string;
  name: string;
  mfaEnabled?: boolean;
  invitedBy?: string;
  joinedAt: string;
  updatedAt: string;
}

/** Organization membership (from /team/my-orgs) */
export interface IOrganizationMembership {
  organizationId: string;
  organizationName: string;
  role: TeamRole;
}

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
  vimeoAccessToken?: string;
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
  customLauncherIconUrl?: string;
  customLauncherHtml?: string;
  customCss?: string;
  typingIndicatorStyle?: TypingIndicatorStyle;
  typingPhrases?: string[];
}

export type WidgetPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type TypingIndicatorStyle = 'dots' | 'phrases' | 'spinner-phrases';

/** Visual-only subset of IWidgetConfig, stored as a reusable org-wide preset */
export interface IWidgetPreset {
  id: string;
  tenantId: string;
  name: string;
  position: WidgetPosition;
  primaryColor: string;
  secondaryColor: string;
  customLauncherIconUrl?: string;
  customLauncherHtml?: string;
  customCss?: string;
  typingIndicatorStyle?: TypingIndicatorStyle;
  typingPhrases?: string[];
  createdAt: string;
  updatedAt: string;
}

/** The visual config fields that a preset can apply to an assistant's widgetConfig */
export type WidgetPresetConfig = Pick<IWidgetConfig,
  | 'position'
  | 'primaryColor'
  | 'secondaryColor'
  | 'customLauncherIconUrl'
  | 'customLauncherHtml'
  | 'customCss'
  | 'typingIndicatorStyle'
  | 'typingPhrases'
>;

/** Context injection configuration for the embed snippet */
export interface IContextConfig {
  passCurrentUrl: boolean;
  passUserId: boolean;
  userIdExpression: string;
  customFields: ICustomContextField[];
}

export type ContextFieldType = 'expression' | 'localStorage' | 'sessionStorage' | 'cookie' | 'dom' | 'meta' | 'userAgent' | 'geolocation';

export interface ICustomContextField {
  key: string;
  type: ContextFieldType;
  expression: string;
  label?: string;
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
