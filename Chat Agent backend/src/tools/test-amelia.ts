#!/usr/bin/env npx ts-node
/**
 * Amelia Bot Tester — tests the Amelia chatbot via REST API and evaluates
 * responses using the same LLM-as-judge scoring as test suites.
 *
 * Usage:
 *   npx ts-node --skip-project src/tools/test-amelia.ts \
 *     --client-id "your-client-id" \
 *     --client-secret "your-secret" \
 *     --questions "how do I add a patient,what is family checkout"
 *
 *   Or with a test suite:
 *   npx ts-node --skip-project src/tools/test-amelia.ts \
 *     --client-id "your-client-id" \
 *     --client-secret "your-secret" \
 *     --suite-id "abc123"
 */

import * as ameliaClient from '../services/amelia-client';
import * as fs from 'fs';

interface ITestResult {
  question: string;
  expectedBehavior?: string;
  ameliaResponse: string;
  responseTimeMs: number;
  evaluation?: {
    overallScore: number;
    metrics: { relevance: number; accuracy: number; completeness: number; tone: number; guardrailCompliance: number };
    reasoning: string;
    issues: string[];
  };
  error?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const username = getArg(args, '--username') ?? '';
  const password = getArg(args, '--password') ?? '';
  const clientId = getArg(args, '--client-id');
  const clientSecret = getArg(args, '--client-secret');
  const baseUrl = getArg(args, '--base-url') ?? 'https://eyefinity.partners.amelia.com/AmeliaRest';
  const domainCode = getArg(args, '--domain');
  const questionsArg = getArg(args, '--questions');
  const suiteId = getArg(args, '--suite-id');
  const outputFile = getArg(args, '--output') ?? '/tmp/amelia-test-results.json';
  const skipEval = args.includes('--no-eval');

  if (!username && !clientId) {
    console.log(`
Usage: npx ts-node --skip-project src/tools/test-amelia.ts [options]

Auth (pick one):
  --username <user>       Amelia username (same as web login)
  --password <pass>       Amelia password
  --client-id <id>        Amelia OAuth client ID (alternative)
  --client-secret <sec>   Amelia OAuth client secret

Options:
  --base-url <url>        Amelia API base URL (default: eyefinity.partners.amelia.com)
  --domain <code>         Amelia domain code
  --questions <q1,q2>     Comma-separated test questions
  --suite-id <id>         Load from existing test suite
  --output <file>         Output file (default: /tmp/amelia-test-results.json)
  --no-eval               Skip LLM-as-judge evaluation

Example:
  npx ts-node --skip-project src/tools/test-amelia.ts \\
    --username "your-amelia-username" \\
    --password "your-password" \\
    --questions "how do I add a patient,what is family checkout"
`);
    process.exit(1);
  }

  // Get questions
  let questions: Array<{ question: string; expectedBehavior?: string }> = [];
  if (questionsArg) {
    questions = questionsArg.split(',').map(q => ({ question: q.trim() }));
  } else if (suiteId) {
    questions = await loadFromSuite(suiteId);
  } else {
    // Default test questions
    questions = [
      { question: 'how do I add a new patient' },
      { question: 'what is family checkout' },
      { question: 'how to check insurance eligibility' },
      { question: 'how do I schedule an appointment' },
      { question: 'what reports are available' },
    ];
  }

  console.log(`\n🤖 Amelia Bot Tester`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Questions: ${questions.length}\n`);

  // Authenticate
  console.log('   Authenticating...');
  const config: ameliaClient.IAmeliaConfig = {
    baseUrl,
    ...(username ? { username, password } : { clientId: clientId!, clientSecret: clientSecret! }),
    domainCode,
  };
  const auth = await ameliaClient.authenticate(config);
  console.log(`   ✅ Authenticated (${auth.authMode})\n`);

  // Create conversation
  console.log('   Creating conversation...');
  const session = await ameliaClient.createConversation(auth, config);
  console.log(`   ✅ Session: ${session.conversationId}\n`);

  // Get welcome message
  const welcome = await ameliaClient.pollResponse(session, true, 3);
  const welcomeText = welcome.filter(m => m.text).map(m => m.text).join(' ');
  console.log(`   Welcome: "${welcomeText.slice(0, 100)}"\n`);

  // Test each question
  const results: ITestResult[] = [];

  for (let i = 0; i < questions.length; i++) {
    const { question, expectedBehavior } = questions[i];
    console.log(`   [${i + 1}/${questions.length}] "${question}"`);

    try {
      const response = await ameliaClient.chat(session, question);
      console.log(`     ✅ ${response.responseTimeMs}ms: "${response.text.slice(0, 100)}${response.text.length > 100 ? '...' : ''}"`);

      results.push({
        question,
        expectedBehavior,
        ameliaResponse: response.text,
        responseTimeMs: response.responseTimeMs,
      });
    } catch (err) {
      console.log(`     ❌ Error: ${err}`);
      results.push({
        question,
        expectedBehavior,
        ameliaResponse: '',
        responseTimeMs: 0,
        error: String(err),
      });
    }

    // Small delay between questions
    await new Promise(r => setTimeout(r, 1000));
  }

  // Close conversation
  await ameliaClient.closeConversation(session);
  console.log('\n   Conversation closed.\n');

  // Evaluate with LLM-as-judge
  if (!skipEval) {
    console.log('   Evaluating with LLM-as-judge...');
    for (const result of results) {
      if (!result.error && result.ameliaResponse) {
        try {
          result.evaluation = await evaluateResponse(result.question, result.expectedBehavior, result.ameliaResponse);
          console.log(`     ${result.evaluation.overallScore}/100 — "${result.question.slice(0, 40)}"`);
        } catch (e) {
          console.log(`     Eval failed: ${e}`);
        }
      }
    }
  }

  // Summary
  const successful = results.filter(r => !r.error);
  const scores = results.filter(r => r.evaluation).map(r => r.evaluation!.overallScore);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const avgTime = successful.length > 0 ? Math.round(successful.reduce((s, r) => s + r.responseTimeMs, 0) / successful.length) : 0;

  const summary = {
    bot: 'Amelia (Encompass Assistance)',
    baseUrl,
    totalQuestions: questions.length,
    successful: successful.length,
    failed: results.filter(r => r.error).length,
    avgResponseTimeMs: avgTime,
    avgScore,
    results,
    testedAt: new Date().toISOString(),
  };

  fs.writeFileSync(outputFile, JSON.stringify(summary, null, 2));

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`   Bot: Amelia (Encompass Assistance)`);
  console.log(`   Total: ${questions.length} | Success: ${successful.length} | Failed: ${summary.failed}`);
  console.log(`   Avg Response Time: ${avgTime}ms`);
  console.log(`   Avg Score: ${avgScore}/100`);
  console.log(`   Results: ${outputFile}`);
  console.log(`${'─'.repeat(50)}\n`);
}

async function evaluateResponse(question: string, expected: string | undefined, actual: string): Promise<ITestResult['evaluation']> {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region: 'us-west-2' });

  const prompt = `Evaluate this AI chatbot response. Score each metric 0-100.

Question: ${question}
${expected ? `Expected: ${expected}` : ''}
Response: ${actual}

Metrics: relevance, accuracy, completeness, tone, guardrailCompliance (each 0-100)
Return ONLY JSON: {"overallScore":N,"metrics":{"relevance":N,"accuracy":N,"completeness":N,"tone":N,"guardrailCompliance":N},"reasoning":"...","issues":["..."]}`;

  const res = await client.send(new InvokeModelCommand({
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  }));

  const parsed = JSON.parse(new TextDecoder().decode(res.body));
  const text = parsed.content?.[0]?.text ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in eval response');
  return JSON.parse(match[0]);
}

async function loadFromSuite(suiteId: string): Promise<Array<{ question: string; expectedBehavior?: string }>> {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, QueryCommand } = await import('@aws-sdk/lib-dynamodb');
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-west-2' }));

  const res = await client.send(new QueryCommand({
    TableName: 'chat-agent-test-cases-dev',
    IndexName: 'suiteId-index',
    KeyConditionExpression: 'suiteId = :s',
    ExpressionAttributeValues: { ':s': suiteId },
  }));

  return (res.Items ?? [])
    .filter((item: any) => item.enabled !== false)
    .map((item: any) => ({
      question: item.turns?.[0]?.userMessage ?? '',
      expectedBehavior: item.turns?.[0]?.expectedBehavior,
    }))
    .filter((q: any) => q.question);
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
