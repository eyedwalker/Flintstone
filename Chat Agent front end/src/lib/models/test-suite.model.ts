/** Categories of test cases */
export type TestCategory =
  | 'factual'
  | 'multi-turn'
  | 'procedural'
  | 'video-citation'
  | 'role-based'
  | 'out-of-scope'
  | 'adversarial'
  | 'edge-case'
  | 'context-dependent';

export type TestCaseSource = 'ai-generated' | 'user-created' | 'imported';

/** Assertion types inspired by Promptfoo */
export interface IAssertion {
  type:
    | 'contains'
    | 'not-contains'
    | 'similar-to'
    | 'mentions-video'
    | 'cites-source'
    | 'tone'
    | 'length-min'
    | 'length-max'
    | 'llm-rubric';
  value: string;
  weight?: number;
}

/** A single conversation turn in a test case */
export interface ITestTurn {
  userMessage: string;
  expectedBehavior: string;
  assertions?: IAssertion[];
}

/** A test case (single or multi-turn) */
export interface ITestCase {
  id: string;
  suiteId: string;
  tenantId: string;
  name: string;
  category: TestCategory;
  source: TestCaseSource;
  sourceContentId?: string;
  priority: 'low' | 'medium' | 'high';
  turns: ITestTurn[];
  roleLevel?: number;
  context?: Record<string, string>;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A test suite — groups related test cases for an assistant */
export interface ITestSuite {
  id: string;
  tenantId: string;
  assistantId: string;
  name: string;
  description: string;
  categories: TestCategory[];
  testCaseCount: number;
  lastRunId?: string;
  lastRunAt?: string;
  lastRunStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export type TestRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** A test run — one execution of a suite */
export interface ITestRun {
  id: string;
  suiteId: string;
  assistantId: string;
  tenantId: string;
  status: TestRunStatus;
  totalCases: number;
  completedCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  avgScore: number;
  improvements?: IImprovement[];
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** AI evaluation metrics */
export interface IEvalMetrics {
  relevance: number;
  accuracy: number;
  completeness: number;
  tone: number;
  guardrailCompliance: number;
}

/** AI evaluation of a test result */
export interface IAiEvaluation {
  overallScore: number;
  metrics: IEvalMetrics;
  reasoning: string;
  issues: string[];
}

/** Per-assertion result */
export interface IAssertionResult {
  type: string;
  passed: boolean;
  detail: string;
}

/** Result for a single conversation turn */
export interface ITestTurnResult {
  userMessage: string;
  expectedBehavior: string;
  actualResponse: string;
  latencyMs: number;
  turnScore: number;
  assertionResults?: IAssertionResult[];
}

/** User review of a test result */
export interface IUserReview {
  rating: number;
  feedback: string;
  tags: string[];
  reviewedAt: string;
}

export type TestResultStatus = 'passed' | 'failed' | 'error';

/** Result of executing a single test case */
export interface ITestResult {
  id: string;
  runId: string;
  testCaseId: string;
  tenantId: string;
  status: TestResultStatus;
  turns: ITestTurnResult[];
  aiEvaluation: IAiEvaluation;
  userReview?: IUserReview;
  durationMs: number;
  sessionId: string;
  createdAt: string;
}

/** Improvement suggestion types */
export type ImprovementType =
  | 'KNOWLEDGE_GAP'
  | 'PROMPT_IMPROVEMENT'
  | 'GUARDRAIL_ADJUSTMENT'
  | 'CONTENT_UPDATE';

/** An AI-generated improvement suggestion */
export interface IImprovement {
  id: string;
  type: ImprovementType;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  proposedContent?: string;
  promptDiff?: { before: string; after: string };
  applied?: boolean;
  appliedAt?: string;
}

/** Options for AI test case generation */
export interface IGenerateOptions {
  count?: number;
  categories?: TestCategory[];
}

/** Review feedback tags */
export const REVIEW_TAGS = [
  'hallucination',
  'incomplete',
  'wrong-tone',
  'off-topic',
  'incorrect',
  'too-verbose',
  'too-brief',
  'missing-video',
  'perfect',
  'guardrail-issue',
] as const;

export type ReviewTag = (typeof REVIEW_TAGS)[number];
