/** A video matched to a screen by AI or admin */
export interface IScreenVideo {
  title: string;
  url: string;
  vimeoId: string;
  relevanceScore: number;
  reason: string;
  pinned: boolean;
}

/** A help article matched to a screen by AI or admin */
export interface IScreenHelpArticle {
  title: string;
  url: string;
  relevanceScore: number;
}

/** Status of a screen mapping record */
export type ScreenMappingStatus = 'ai-generated' | 'reviewed' | 'custom';

/** A mapping of an Encompass screen to relevant videos and trending questions */
export interface IScreenMapping {
  id: string;
  assistantId: string;
  tenantId: string;
  screenName: string;
  section: string;
  urlPattern: string;
  urlRegex: string;
  purpose: string;
  videos: IScreenVideo[];
  helpArticles: IScreenHelpArticle[];
  trendingQuestions: string[];
  status: ScreenMappingStatus;
  createdAt: string;
  updatedAt: string;
}

/** Response from the AI generate endpoint */
export interface IGenerateMappingsResult {
  count: number;
  status: string;
}
