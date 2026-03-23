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
  modelId?: string;
  iterationId?: string;
  approvedForTraining?: number;
  /** Set to 'amelia' when this run tested an external bot instead of Bedrock */
  externalBot?: string;
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
  trainerAnnotation?: ITrainerAnnotation;
  durationMs: number;
  sessionId: string;
  /** Set to 'amelia' when this result is from an external bot test */
  externalBot?: string;
  createdAt: string;
}

/** External bot (Amelia) connection configuration */
export interface IExternalBotConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  domainCode?: string;
}

/** Quick ad-hoc test result from external bot */
export interface IExternalBotQuickResult {
  question: string;
  response: string;
  responseTimeMs: number;
  error?: string;
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

// ── RAFT (Retrieval-Augmented Fine-Tuning) Types ──────────────────────────────

/** Trainer correction for a single conversation turn */
export interface ITrainerCorrection {
  turnIndex: number;
  idealResponse: string;
  correctionNotes?: string;
  retrievalContext?: string;
}

/** Training readiness status */
export type TrainingStatus = 'unreviewed' | 'corrected' | 'approved' | 'excluded';

/** Trainer annotation on a test result — extends ITestResult */
export interface ITrainerAnnotation {
  corrections: ITrainerCorrection[];
  trainingStatus: TrainingStatus;
  annotatedBy: string;
  annotatedAt: string;
}

/** Training dataset metadata */
export interface ITrainingDataset {
  id: string;
  tenantId: string;
  assistantId: string;
  name: string;
  description: string;
  sourceRunIds: string[];
  format: 'bedrock-llama' | 'bedrock-titan' | 'huggingface-raft';
  totalExamples: number;
  s3Key: string;
  fileSizeBytes: number;
  splitConfig: { trainPct: number; validationPct: number };
  createdAt: string;
  updatedAt: string;
}

/** Fine-tuning job status */
export type FineTuningStatus =
  | 'pending' | 'validating' | 'training' | 'completed' | 'failed' | 'cancelled';

/** Fine-tuning hyperparameters */
export interface IHyperparameters {
  epochs: number;
  batchSize: number;
  learningRate: number;
  warmupSteps: number;
  loraRank?: number;
  loraAlpha?: number;
  loraDropout?: number;
}

/** Training metrics from a fine-tuning job */
export interface ITrainingMetrics {
  trainingLoss: number;
  validationLoss: number;
  perplexity?: number;
  epochMetrics: Array<{ epoch: number; trainingLoss: number; validationLoss: number }>;
}

/** Fine-tuning job record */
export interface IFineTuningJob {
  id: string;
  tenantId: string;
  assistantId: string;
  datasetId: string;
  baseModelId: string;
  customModelName: string;
  bedrockJobArn?: string;
  bedrockCustomModelArn?: string;
  provisionedModelArn?: string;
  status: FineTuningStatus;
  hyperparameters: IHyperparameters;
  trainingMetrics?: ITrainingMetrics;
  errorMessage?: string;
  iteration: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** RAFT iteration — one full cycle of test -> correct -> train -> re-test */
export type RaftStatus =
  | 'testing' | 'reviewing' | 'training' | 'deploying' | 'retesting' | 'completed';

export interface IRaftIteration {
  id: string;
  tenantId: string;
  assistantId: string;
  iterationNumber: number;
  testRunId: string;
  datasetId?: string;
  fineTuningJobId?: string;
  ragImprovementIds?: string[];
  baselineScore: number;
  improvedScore?: number;
  reformulatedPromptPct: number;
  status: RaftStatus;
  track?: 'rag' | 'finetune' | 'hybrid';
  createdAt: string;
  updatedAt: string;
}

/** Model comparison (A/B test results) */
export interface IModelComparison {
  id: string;
  tenantId: string;
  assistantId: string;
  suiteId: string;
  baseRunId: string;
  challengerRunId: string;
  baseModelId: string;
  challengerModelId: string;
  baseAvgScore: number;
  challengerAvgScore: number;
  scoreDelta: number;
  perCategoryDeltas: Record<string, number>;
  winRate: number;
  createdAt: string;
}
