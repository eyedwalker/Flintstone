#!/usr/bin/env npx ts-node
/**
 * External Bot Tester — drives a web-based chatbot (Amelia) via Playwright
 * and evaluates responses using the same LLM-as-judge scoring as test suites.
 *
 * Usage:
 *   npx ts-node src/tools/external-bot-tester.ts \
 *     --url "https://pm-ci.eyefinity.com/EPM/" \
 *     --suite-id "abc123" \
 *     --output results.json
 *
 *   Or with inline test cases:
 *   npx ts-node src/tools/external-bot-tester.ts \
 *     --url "https://pm-ci.eyefinity.com/EPM/" \
 *     --questions "how do I add a patient,what is family checkout,how to invoice"
 */

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';

// ── Configuration ─────────────────────────────────────────────────────────────

interface ITestConfig {
  url: string;                    // Page URL where Amelia widget is embedded
  suiteId?: string;               // Pull test cases from existing suite
  questions?: string[];           // Or provide inline questions
  outputFile?: string;            // Write results to JSON file
  headless?: boolean;             // Run headless (default true)
  timeout?: number;               // Response timeout per message (ms, default 30000)
  delayBetween?: number;          // Delay between messages (ms, default 2000)
  maxMessages?: number;           // Max messages to send (default all)
  evaluate?: boolean;             // Run LLM-as-judge evaluation (default true)
  // Amelia widget selectors (auto-detected, override if needed)
  selectors?: {
    input?: string;
    sendButton?: string;
    responseContainer?: string;
    lastResponse?: string;
  };
}

const DEFAULT_SELECTORS = {
  // Amelia widget selectors based on the screenshot
  input: 'input[placeholder="Type message here"], textarea[placeholder="Type message here"]',
  sendButton: 'button.send-button, button[aria-label="Send"], .amelia-send-btn, button:has(svg)',
  responseContainer: '.amelia-chat-messages, .chat-messages, .message-list',
  lastResponse: '.amelia-message:last-child .message-text, .bot-message:last-child, .assistant-message:last-child',
};

// ── Result Types ──────────────────────────────────────────────────────────────

interface IExternalTestResult {
  question: string;
  expectedBehavior?: string;
  botResponse: string;
  responseTimeMs: number;
  evaluation?: {
    overallScore: number;
    metrics: { relevance: number; accuracy: number; completeness: number; tone: number; guardrailCompliance: number };
    reasoning: string;
    issues: string[];
  };
  error?: string;
  timestamp: string;
}

interface ITestRunSummary {
  botName: string;
  botUrl: string;
  totalQuestions: number;
  successfulResponses: number;
  failedResponses: number;
  avgResponseTimeMs: number;
  avgScore?: number;
  results: IExternalTestResult[];
  startedAt: string;
  completedAt: string;
}

// ── Main Test Runner ──────────────────────────────────────────────────────────

async function runExternalBotTest(config: ITestConfig): Promise<ITestRunSummary> {
  const startedAt = new Date().toISOString();
  console.log(`\n🤖 External Bot Tester`);
  console.log(`   URL: ${config.url}`);
  console.log(`   Questions: ${config.questions?.length ?? 'from suite ' + config.suiteId}`);
  console.log(`   Headless: ${config.headless !== false}\n`);

  // Get test questions
  let questions: Array<{ question: string; expectedBehavior?: string }> = [];

  if (config.questions) {
    questions = config.questions.map(q => ({ question: q }));
  } else if (config.suiteId) {
    questions = await loadQuestionsFromSuite(config.suiteId);
  }

  if (config.maxMessages) {
    questions = questions.slice(0, config.maxMessages);
  }

  if (questions.length === 0) {
    throw new Error('No test questions provided. Use --questions or --suite-id');
  }

  console.log(`   Loaded ${questions.length} test questions\n`);

  // Launch browser
  const browser = await chromium.launch({
    headless: config.headless !== false,
  });

  const results: IExternalTestResult[] = [];
  let page: Page | null = null;

  try {
    page = await browser.newPage();

    // Navigate to the page with the widget
    console.log(`   Navigating to ${config.url}...`);
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait for the Amelia widget to load
    console.log(`   Waiting for Amelia widget...`);
    await waitForWidget(page, config);

    // Take a screenshot for debugging
    await page.screenshot({ path: '/tmp/amelia-widget-loaded.png' });
    console.log(`   Widget loaded (screenshot: /tmp/amelia-widget-loaded.png)\n`);

    // Send each question
    for (let i = 0; i < questions.length; i++) {
      const { question, expectedBehavior } = questions[i];
      console.log(`   [${i + 1}/${questions.length}] "${question.slice(0, 60)}${question.length > 60 ? '...' : ''}"`);

      const result = await sendAndCapture(page, question, expectedBehavior, config);
      results.push(result);

      if (result.error) {
        console.log(`     ❌ Error: ${result.error}`);
      } else {
        console.log(`     ✅ Response (${result.responseTimeMs}ms): "${result.botResponse.slice(0, 80)}${result.botResponse.length > 80 ? '...' : ''}"`);
      }

      // Delay between messages
      if (i < questions.length - 1) {
        await page.waitForTimeout(config.delayBetween ?? 2000);
      }
    }

    // Evaluate responses with LLM-as-judge
    if (config.evaluate !== false) {
      console.log(`\n   Evaluating responses with LLM-as-judge...`);
      for (const result of results) {
        if (!result.error && result.botResponse) {
          try {
            result.evaluation = await evaluateResponse(result.question, result.expectedBehavior, result.botResponse);
            console.log(`     Score: ${result.evaluation.overallScore}/100 — "${result.question.slice(0, 40)}..."`);
          } catch (e) {
            console.log(`     Eval failed: ${e}`);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  // Build summary
  const successful = results.filter(r => !r.error);
  const scores = results.filter(r => r.evaluation).map(r => r.evaluation!.overallScore);

  const summary: ITestRunSummary = {
    botName: 'Amelia (Encompass Assistance)',
    botUrl: config.url,
    totalQuestions: questions.length,
    successfulResponses: successful.length,
    failedResponses: results.filter(r => r.error).length,
    avgResponseTimeMs: successful.length > 0
      ? Math.round(successful.reduce((sum, r) => sum + r.responseTimeMs, 0) / successful.length)
      : 0,
    avgScore: scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : undefined,
    results,
    startedAt,
    completedAt: new Date().toISOString(),
  };

  // Output
  if (config.outputFile) {
    fs.writeFileSync(config.outputFile, JSON.stringify(summary, null, 2));
    console.log(`\n   Results written to ${config.outputFile}`);
  }

  // Print summary
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`   Bot: ${summary.botName}`);
  console.log(`   Total: ${summary.totalQuestions} questions`);
  console.log(`   Success: ${summary.successfulResponses} | Failed: ${summary.failedResponses}`);
  console.log(`   Avg Response Time: ${summary.avgResponseTimeMs}ms`);
  if (summary.avgScore !== undefined) {
    console.log(`   Avg Score: ${summary.avgScore}/100`);
  }
  console.log(`${'─'.repeat(60)}\n`);

  return summary;
}

// ── Widget Interaction ────────────────────────────────────────────────────────

async function waitForWidget(page: Page, config: ITestConfig): Promise<void> {
  const selectors = config.selectors ?? DEFAULT_SELECTORS;

  // Try multiple strategies to find the widget
  const strategies = [
    // Strategy 1: Look for Amelia iframe
    async () => {
      const frame = page.frameLocator('iframe[src*="amelia"], iframe[src*="Amelia"]');
      const input = frame.locator(selectors.input);
      if (await input.count() > 0) {
        console.log('   Found Amelia in iframe');
        return true;
      }
      return false;
    },
    // Strategy 2: Direct DOM
    async () => {
      await page.waitForSelector(selectors.input, { timeout: 15000 });
      return true;
    },
    // Strategy 3: Shadow DOM
    async () => {
      const found = await page.evaluate(() => {
        const els = document.querySelectorAll('*');
        for (const el of els) {
          if (el.shadowRoot) {
            const input = el.shadowRoot.querySelector('input[placeholder*="message"], textarea[placeholder*="message"]');
            if (input) return true;
          }
        }
        return false;
      });
      if (found) console.log('   Found Amelia in shadow DOM');
      return found;
    },
    // Strategy 4: Wait longer and try any input
    async () => {
      await page.waitForTimeout(5000);
      const inputs = await page.locator('input[placeholder*="message"], input[placeholder*="Message"], textarea[placeholder*="message"]').count();
      return inputs > 0;
    },
  ];

  for (const strategy of strategies) {
    try {
      if (await strategy()) return;
    } catch { /* try next */ }
  }

  // Last resort: take screenshot and throw
  await page.screenshot({ path: '/tmp/amelia-not-found.png' });
  throw new Error('Could not find Amelia widget. Screenshot saved to /tmp/amelia-not-found.png');
}

async function sendAndCapture(
  page: Page,
  question: string,
  expectedBehavior: string | undefined,
  config: ITestConfig,
): Promise<IExternalTestResult> {
  const selectors = config.selectors ?? DEFAULT_SELECTORS;
  const timeout = config.timeout ?? 30000;
  const startTime = Date.now();

  try {
    // Count existing messages before sending
    const beforeCount = await countBotMessages(page);

    // Type the message
    const input = page.locator(selectors.input).first();
    await input.fill(question);

    // Click send (try multiple selectors)
    const sendClicked = await clickSend(page, selectors);
    if (!sendClicked) {
      // Fallback: press Enter
      await input.press('Enter');
    }

    // Wait for new bot response
    const response = await waitForNewResponse(page, beforeCount, timeout);

    return {
      question,
      expectedBehavior,
      botResponse: response,
      responseTimeMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      question,
      expectedBehavior,
      botResponse: '',
      responseTimeMs: Date.now() - startTime,
      error: String(err),
      timestamp: new Date().toISOString(),
    };
  }
}

async function clickSend(page: Page, selectors: typeof DEFAULT_SELECTORS): Promise<boolean> {
  // Try various send button selectors
  const candidates = [
    selectors.sendButton,
    'button:has(svg path[d*="2.01"])',  // Send icon SVG path
    '.send-button',
    'button[type="submit"]',
    'button:last-child',
  ];

  for (const sel of candidates) {
    try {
      const btn = page.locator(sel).last();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

async function countBotMessages(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Count all bot/assistant message elements
    const selectors = [
      '.bot-message', '.assistant-message', '.amelia-message',
      '[class*="bot"]', '[class*="assistant"]',
      '.message-bubble:not(.user)', '.chat-bubble:not(.user)',
    ];
    let max = 0;
    for (const sel of selectors) {
      const count = document.querySelectorAll(sel).length;
      if (count > max) max = count;
    }
    return max;
  });
}

async function waitForNewResponse(page: Page, beforeCount: number, timeout: number): Promise<string> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);

    // Check for new bot messages
    const text = await page.evaluate((prevCount) => {
      // Try various selectors to find bot messages
      const selectors = [
        '.bot-message', '.assistant-message', '.amelia-message',
        '[class*="message-text"]', '.message-content',
        '.chat-bubble:not(.user-message)',
      ];

      for (const sel of selectors) {
        const msgs = document.querySelectorAll(sel);
        if (msgs.length > prevCount) {
          // Get the last message text
          const last = msgs[msgs.length - 1];
          return last.textContent?.trim() ?? '';
        }
      }

      // Fallback: get all text content from the message area
      const container = document.querySelector('.chat-messages, .message-list, .amelia-chat');
      if (container) {
        const allText = container.textContent ?? '';
        return allText.trim();
      }

      return null;
    }, beforeCount);

    if (text && text.length > 0) {
      // Wait a bit more for the full response to render
      await page.waitForTimeout(1500);

      // Re-capture to get the complete text
      const finalText = await page.evaluate(() => {
        const selectors = [
          '.bot-message:last-child', '.assistant-message:last-child',
          '.amelia-message:last-child', '[class*="message-text"]:last-child',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el.textContent?.trim() ?? '';
        }
        return '';
      });

      return finalText || text;
    }
  }

  throw new Error(`No response within ${timeout}ms`);
}

// ── LLM-as-Judge Evaluation ───────────────────────────────────────────────────

async function evaluateResponse(
  question: string,
  expectedBehavior: string | undefined,
  actualResponse: string,
): Promise<IExternalTestResult['evaluation']> {
  // Use Bedrock Claude to evaluate (same as test-runner.ts)
  const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region: 'us-west-2' });

  const prompt = `You are evaluating an AI chatbot's response quality. Score each metric 0-100.

Question: ${question}
${expectedBehavior ? `Expected behavior: ${expectedBehavior}` : ''}
Actual response: ${actualResponse}

Score these metrics:
- relevance (0-100): Does the response address the user's question?
- accuracy (0-100): Is the information factually correct?
- completeness (0-100): Is the answer thorough enough?
- tone (0-100): Is the tone professional and appropriate?
- guardrailCompliance (0-100): Does it stay within appropriate boundaries?

Return ONLY valid JSON:
{"overallScore": N, "metrics": {"relevance": N, "accuracy": N, "completeness": N, "tone": N, "guardrailCompliance": N}, "reasoning": "...", "issues": ["..."]}`;

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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in evaluation response');

  return JSON.parse(jsonMatch[0]);
}

// ── Load from Existing Suite ──────────────────────────────────────────────────

async function loadQuestionsFromSuite(suiteId: string): Promise<Array<{ question: string; expectedBehavior?: string }>> {
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, QueryCommand } = await import('@aws-sdk/lib-dynamodb');

  const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-west-2' }));

  const res = await ddbClient.send(new QueryCommand({
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

// ── CLI Entry Point ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const config: ITestConfig = {
    url: getArg(args, '--url') ?? '',
    suiteId: getArg(args, '--suite-id'),
    questions: getArg(args, '--questions')?.split(',').map(q => q.trim()),
    outputFile: getArg(args, '--output') ?? '/tmp/external-bot-results.json',
    headless: !args.includes('--visible'),
    timeout: parseInt(getArg(args, '--timeout') ?? '30000'),
    delayBetween: parseInt(getArg(args, '--delay') ?? '2000'),
    maxMessages: getArg(args, '--max') ? parseInt(getArg(args, '--max')!) : undefined,
    evaluate: !args.includes('--no-eval'),
  };

  if (!config.url) {
    console.log(`
Usage: npx ts-node src/tools/external-bot-tester.ts [options]

Options:
  --url <url>           Page URL where the chatbot widget is embedded (required)
  --suite-id <id>       Load test cases from an existing test suite
  --questions <q1,q2>   Comma-separated list of test questions
  --output <file>       Output file for results (default: /tmp/external-bot-results.json)
  --visible             Show the browser (default: headless)
  --timeout <ms>        Response timeout per message (default: 30000)
  --delay <ms>          Delay between messages (default: 2000)
  --max <n>             Max messages to send
  --no-eval             Skip LLM-as-judge evaluation

Examples:
  # Quick test with inline questions
  npx ts-node src/tools/external-bot-tester.ts \\
    --url "https://pm-ci.eyefinity.com/EPM/" \\
    --questions "how do I add a patient,what is family checkout" \\
    --visible

  # Full suite test
  npx ts-node src/tools/external-bot-tester.ts \\
    --url "https://pm-ci.eyefinity.com/EPM/" \\
    --suite-id "your-suite-id-here"

  # Compare with your Bedrock agent
  # 1. Run test suite on your agent (in the app)
  # 2. Run same suite on Amelia:
  npx ts-node src/tools/external-bot-tester.ts \\
    --url "https://pm-ci.eyefinity.com/EPM/" \\
    --suite-id "same-suite-id"
  # 3. Compare results in the RAFT dashboard
`);
    process.exit(1);
  }

  await runExternalBotTest(config);
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
