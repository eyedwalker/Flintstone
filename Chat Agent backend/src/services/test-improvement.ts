/**
 * AI Improvement Engine
 *
 * Analyzes test run results to suggest knowledge base and prompt improvements.
 */
import { v4 as uuidv4 } from 'uuid';
import * as ddb from './dynamo';
import * as s3 from './s3';
import { invokeModel } from './bedrock-chat';

const TEST_RESULTS_TABLE = process.env['TEST_RESULTS_TABLE'] ?? '';
const TEST_RUNS_TABLE = process.env['TEST_RUNS_TABLE'] ?? '';
const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';
const CONTENT_TABLE = process.env['CONTENT_TABLE'] ?? '';

interface ITestResult {
  id: string;
  runId: string;
  testCaseId: string;
  status: string;
  turns: { userMessage: string; expectedBehavior: string; actualResponse: string }[];
  aiEvaluation: { overallScore: number; reasoning: string; issues: string[] };
  userReview?: { rating: number; feedback: string; tags: string[] };
}

interface IImprovement {
  id: string;
  type: 'KNOWLEDGE_GAP' | 'PROMPT_IMPROVEMENT' | 'GUARDRAIL_ADJUSTMENT' | 'CONTENT_UPDATE';
  title: string;
  description: string;
  priority: string;
  proposedContent?: string;
  promptDiff?: { before: string; after: string };
  applied?: boolean;
  appliedAt?: string;
}

interface IAssistant {
  id: string;
  tenantId: string;
  modelConfig: { systemPrompt?: string };
  bedrockGuardrailId?: string;
}

interface ITestRun {
  id: string;
  suiteId: string;
  assistantId: string;
  tenantId: string;
  improvements?: IImprovement[];
}

/**
 * Analyze test run results and generate improvement suggestions.
 */
export async function analyzeRunResults(
  runId: string,
  assistantId: string,
  tenantId: string,
): Promise<IImprovement[]> {
  // Load all results for the run
  const results = await ddb.queryItems<ITestResult>(
    TEST_RESULTS_TABLE, 'runId = :r', { ':r': runId }, undefined, 'runId-index',
  );

  // Filter to problematic results: low AI score OR negative user review
  const problems = results.filter(r =>
    r.aiEvaluation?.overallScore < 60 ||
    (r.userReview && r.userReview.rating <= 2)
  );

  if (problems.length === 0) {
    return [{
      id: uuidv4(),
      type: 'KNOWLEDGE_GAP',
      title: 'No significant issues found',
      description: 'All test cases scored above threshold. Consider adding more challenging test cases or increasing the pass threshold.',
      priority: 'low',
    }];
  }

  // Load assistant for system prompt context
  const assistant = await ddb.getItem<IAssistant>(ASSISTANTS_TABLE, { id: assistantId });
  const systemPrompt = assistant?.modelConfig?.systemPrompt || '(no system prompt set)';

  // Build failure summary for AI analysis
  const failureSummaries = problems.slice(0, 30).map(r => {
    const turns = r.turns.map(t =>
      `Q: ${t.userMessage}\nExpected: ${t.expectedBehavior}\nActual: ${t.actualResponse.slice(0, 500)}`
    ).join('\n');
    const review = r.userReview
      ? `User rating: ${r.userReview.rating}/5, feedback: ${r.userReview.feedback}, tags: ${r.userReview.tags.join(', ')}`
      : '';
    return `[Score: ${r.aiEvaluation.overallScore}/100] ${r.aiEvaluation.reasoning}\nIssues: ${r.aiEvaluation.issues.join('; ')}\n${turns}\n${review}`;
  }).join('\n\n---\n\n');

  // AI analysis with Claude Sonnet for higher quality
  const analysisPrompt = `Analyze these ${problems.length} failing test results for an AI assistant and suggest concrete improvements.

Current system prompt:
---
${systemPrompt.slice(0, 3000)}
---

Failing test results:
${failureSummaries}

Generate improvement suggestions. Categories:
1. KNOWLEDGE_GAP — Missing content in the knowledge base. Include proposedContent (the actual text to add).
2. PROMPT_IMPROVEMENT — System prompt needs refinement. Include promptDiff with before/after snippets.
3. GUARDRAIL_ADJUSTMENT — Safety rules too strict or too loose.
4. CONTENT_UPDATE — Existing KB content needs correction.

For each suggestion provide:
- type: One of the categories above
- title: Short descriptive title
- description: Detailed explanation of what's wrong and how to fix it
- priority: "high", "medium", or "low"
- proposedContent: (for KNOWLEDGE_GAP) The actual text content to add to the knowledge base
- promptDiff: (for PROMPT_IMPROVEMENT) { before: "relevant excerpt of current prompt", after: "improved version" }

Return ONLY a JSON array of suggestions. No markdown, just JSON.`;

  try {
    const response = await invokeModel(
      'You are an AI improvement consultant. Analyze test failures and suggest concrete, actionable improvements. Respond only with valid JSON.',
      analysisPrompt,
      true, // useSonnet for higher quality analysis
    );

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');

    const suggestions = JSON.parse(jsonMatch[0]) as Array<{
      type: string; title: string; description: string;
      priority: string; proposedContent?: string;
      promptDiff?: { before: string; after: string };
    }>;

    return suggestions.map(s => ({
      id: uuidv4(),
      type: s.type as IImprovement['type'],
      title: s.title,
      description: s.description,
      priority: s.priority || 'medium',
      proposedContent: s.proposedContent,
      promptDiff: s.promptDiff,
      applied: false,
    }));
  } catch (e) {
    console.error('Improvement analysis error:', e);
    return [{
      id: uuidv4(),
      type: 'KNOWLEDGE_GAP',
      title: 'Analysis failed',
      description: `Could not analyze results: ${String(e)}`,
      priority: 'low',
    }];
  }
}

/**
 * Apply a specific improvement suggestion.
 */
export async function applyImprovement(
  run: ITestRun,
  improvementId: string,
): Promise<void> {
  const improvements = run.improvements ?? [];
  const improvement = improvements.find(i => i.id === improvementId);
  if (!improvement) throw new Error('Improvement not found');

  const assistant = await ddb.getItem<IAssistant>(ASSISTANTS_TABLE, { id: run.assistantId });
  if (!assistant) throw new Error('Assistant not found');

  switch (improvement.type) {
    case 'KNOWLEDGE_GAP': {
      if (!improvement.proposedContent) break;

      // Create a new content item in the KB
      const contentId = uuidv4();
      const s3Key = `${run.tenantId}/${run.assistantId}/${contentId}/improvement.txt`;

      await s3.putObject(s3Key, improvement.proposedContent, 'text/plain');
      await s3.putJsonObject(`${s3Key}.metadata.json`, {
        metadataAttributes: {
          minRoleLevel: 0,
          scope: 'tenant',
          contentId,
          assistantId: run.assistantId,
        },
      });

      await ddb.putItem(CONTENT_TABLE, {
        id: contentId,
        assistantId: run.assistantId,
        tenantId: run.tenantId,
        name: `AI Improvement: ${improvement.title}`,
        type: 'text',
        scope: 'tenant',
        minRoleLevel: 0,
        s3Key,
        status: 'ready', // Will need manual ingestion trigger
        fileSize: Buffer.byteLength(improvement.proposedContent, 'utf-8'),
        tags: ['ai-improvement'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      break;
    }

    case 'PROMPT_IMPROVEMENT': {
      if (!improvement.promptDiff?.after) break;

      const currentPrompt = assistant.modelConfig?.systemPrompt ?? '';
      let newPrompt = currentPrompt;

      if (improvement.promptDiff.before) {
        // Replace the specific section
        newPrompt = currentPrompt.replace(improvement.promptDiff.before, improvement.promptDiff.after);
      } else {
        // Append if no specific section to replace
        newPrompt = currentPrompt + '\n\n' + improvement.promptDiff.after;
      }

      await ddb.updateItem(ASSISTANTS_TABLE, { id: run.assistantId }, {
        'modelConfig.systemPrompt': newPrompt,
        updatedAt: new Date().toISOString(),
      });
      break;
    }

    case 'GUARDRAIL_ADJUSTMENT':
    case 'CONTENT_UPDATE':
      // These are informational — admin applies manually
      break;
  }

  // Mark improvement as applied
  improvement.applied = true;
  improvement.appliedAt = new Date().toISOString();
  await ddb.updateItem(TEST_RUNS_TABLE, { id: run.id }, {
    improvements,
    updatedAt: new Date().toISOString(),
  });
}
