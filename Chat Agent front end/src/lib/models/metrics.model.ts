/** Time range for metrics queries */
export type MetricsTimeRange = '24h' | '7d' | '30d' | '90d' | 'custom';

/** Aggregated metrics for a tenant or assistant */
export interface IMetricsSummary {
  totalConversations: number;
  totalMessages: number;
  uniqueSessions: number;
  avgMessagesPerSession: number;
  avgSessionDurationSeconds: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  satisfactionRate: number;
  guardrailTriggerCount: number;
  guardrailTriggerRate: number;
  unansweredCount: number;
  unansweredRate: number;
  citationHitCount: number;
  citationHitRate: number;
  videoSurfacedCount: number;
  period: string;
  tenantId?: string;
  assistantId?: string;
}

/** Time series data point */
export interface ITimeSeriesPoint {
  timestamp: string;
  value: number;
  label?: string;
}

/** Hourly usage heatmap data */
export interface IUsageHeatmap {
  day: number;
  hour: number;
  count: number;
}

/** Top questions asked */
export interface ITopQuestion {
  question: string;
  count: number;
  lastAskedAt: string;
  avgSatisfaction?: number;
}

/** Most cited videos */
export interface ITopVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  platform: string;
  citationCount: number;
  assistantId: string;
}

/** Full metrics dashboard data */
export interface IMetricsDashboard {
  summary: IMetricsSummary;
  messageTimeSeries: ITimeSeriesPoint[];
  sessionTimeSeries: ITimeSeriesPoint[];
  satisfactionTimeSeries: ITimeSeriesPoint[];
  usageHeatmap: IUsageHeatmap[];
  topQuestions: ITopQuestion[];
  topVideos: ITopVideo[];
  perAssistantBreakdown: IAssistantMetricBreakdown[];
}

/** Per-assistant metrics row */
export interface IAssistantMetricBreakdown {
  assistantId: string;
  assistantName: string;
  messages: number;
  sessions: number;
  satisfactionRate: number;
  guardrailRate: number;
}

/** Feedback event from widget */
export interface IFeedbackEvent {
  sessionId: string;
  messageId: string;
  assistantId: string;
  tenantId: string;
  feedback: 'positive' | 'negative';
  timestamp: string;
}

/** Billing usage for Stripe metered billing */
export interface IBillingUsage {
  tenantId: string;
  period: string;
  messages: number;
  storageBytes: number;
  videosIngested: number;
  overageMessages: number;
  overageStorageBytes: number;
  estimatedOverageCost: number;
}
