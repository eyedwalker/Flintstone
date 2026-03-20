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

/* eslint-disable @typescript-eslint/no-explicit-any */

import playwright from 'playwright';
const chromium = playwright.chromium;
type Page = any;
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
  // Login credentials (for apps behind auth)
  login?: {
    officeId?: string;
    username?: string;
    password?: string;
  };
  // Amelia widget selectors (auto-detected, override if needed)
  selectors?: {
    input?: string;
    sendButton?: string;
    responseContainer?: string;
    lastResponse?: string;
  };
}

const DEFAULT_SELECTORS = {
  // Amelia widget selectors
  input: 'input[placeholder="Type message here"], textarea[placeholder="Type message here"], input[placeholder*="message" i], textarea[placeholder*="message" i]',
  sendButton: 'button.send-button, button[aria-label="Send"], .amelia-send-btn',
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

    // Navigate to the page
    console.log(`   Navigating to ${config.url}...`);
    await page.goto(config.url, { waitUntil: 'networkidle', timeout: 60000 });

    // Login if credentials provided
    if (config.login?.username) {
      console.log(`   Logging in as ${config.login.username}...`);
      await loginToEncompass(page, config.login);
    }

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
            console.log(`     Score: ${result.evaluation!.overallScore}/100 — "${result.question.slice(0, 40)}..."`);
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

// ── Login ─────────────────────────────────────────────────────────────────────

async function loginToEncompass(page: Page, login: { officeId?: string; username?: string; password?: string }): Promise<void> {
  try {
    // Fill Office ID (input#practiceLocationId)
    if (login.officeId) {
      await page.waitForSelector('#practiceLocationId', { timeout: 10000 });
      await page.click('#practiceLocationId');
      await page.fill('#practiceLocationId', login.officeId);
      await page.waitForTimeout(500);
      // Tab to next field
      await page.press('#practiceLocationId', 'Tab');
      await page.waitForTimeout(500);
      console.log(`     Office ID: ${login.officeId}`);
    }

    // Fill Username — use keyboard typing since fill() may conflict with data-bind
    if (login.username) {
      // The tab from office ID should have focused username. If not, click it.
      try {
        const userField = page.locator('input[name="username"], input[name="practiceLocationId"] ~ div input, #username');
        if (await userField.first().isVisible({ timeout: 3000 })) {
          await userField.first().click();
        }
      } catch {
        // Already focused from tab
      }
      await page.waitForTimeout(300);
      // Select all existing text and replace
      await page.keyboard.press('Control+a');
      await page.keyboard.type(login.username, { delay: 50 });
      await page.waitForTimeout(500);
      console.log(`     Username: ${login.username}`);
      // Tab past "Remember Username" checkbox into password
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
    }

    // Fill Password
    if (login.password) {
      // Click the password field directly
      try {
        await page.click('#password', { timeout: 3000 });
      } catch {
        // Already focused from tabs
      }
      await page.waitForTimeout(300);
      await page.keyboard.press('Control+a');
      await page.keyboard.type(login.password, { delay: 30 });
      await page.waitForTimeout(500);
      console.log(`     Password: ****`);
    }

    // Take screenshot before clicking login
    await page.screenshot({ path: '/tmp/amelia-before-login.png' });
    console.log(`     Screenshot: /tmp/amelia-before-login.png`);

    // Click Login button
    const loginBtn = page.locator('button:has-text("Login"), input[type="submit"], button[type="submit"], .btn-primary:has-text("Login")');
    await loginBtn.first().click();
    console.log(`     Clicked Login...`);

    // Wait for navigation / page load after login
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check if we're still on the login page (login failed)
    const url = page.url();
    if (url.includes('login')) {
      await page.screenshot({ path: '/tmp/amelia-login-failed.png' });
      console.log(`     ⚠️  May still be on login page. Screenshot: /tmp/amelia-login-failed.png`);
      await page.waitForTimeout(5000);
    }

    console.log(`     ✅ Logged in. Current URL: ${page.url()}`);

    // Dismiss any popups/modals (e.g., "HEAVY EDT-19343" notification)
    await page.waitForTimeout(2000);
    try {
      // Try clicking "Done", "Close", "X", or "OK" buttons on any popups
      const dismissBtns = [
        'button:has-text("Done")',
        'button:has-text("OK")',
        'button:has-text("Close")',
        '.modal button.btn-primary',
        'button.close',
        '[aria-label="Close"]',
      ];
      for (const sel of dismissBtns) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          console.log(`     Dismissed popup (${sel})`);
          await page.waitForTimeout(1000);
          break;
        }
      }
    } catch { /* no popup to dismiss */ }

    // Click the Amelia chat bubble to open the widget
    await page.waitForTimeout(3000);

    // Try multiple approaches to find and click the Amelia launcher
    let chatOpened = false;

    // Approach 1: Look for Amelia-specific elements
    const ameliaSelectors = [
      '#amelia-chat-button',
      '#amelia-launcher',
      '[id*="amelia" i]',
      '[class*="amelia" i]',
      '[class*="Amelia" i]',
      'div[class*="launcher"]',
      'button[class*="launcher"]',
    ];

    for (const sel of ameliaSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1000 })) {
          await el.click();
          console.log(`     Opened Amelia via: ${sel}`);
          chatOpened = true;
          break;
        }
      } catch { /* try next */ }
    }

    // Approach 2: Find the floating chat icon by looking at all elements in bottom-right
    if (!chatOpened) {
      try {
        chatOpened = await page.evaluate(() => {
          const doc = (globalThis as any).document;
          // Look for fixed/absolute positioned elements near bottom-right
          const all = doc.querySelectorAll('*');
          for (const el of all) {
            const style = (globalThis as any).getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            if ((style.position === 'fixed' || style.position === 'absolute') &&
                rect.bottom > (globalThis as any).innerHeight - 100 &&
                rect.right > (globalThis as any).innerWidth - 100 &&
                rect.width < 80 && rect.height < 80 &&
                rect.width > 30) {
              el.click();
              return true;
            }
          }
          return false;
        });
        if (chatOpened) console.log(`     Opened Amelia via position detection`);
      } catch { /* continue */ }
    }

    // Approach 3: Click at the bottom-right corner coordinates
    if (!chatOpened) {
      try {
        const viewport = page.viewportSize();
        if (viewport) {
          // Click where the chat bubble typically sits (bottom-right, ~40px from edges)
          await page.mouse.click(viewport.width - 40, viewport.height - 40);
          console.log(`     Clicked bottom-right corner (${viewport.width - 40}, ${viewport.height - 40})`);
          chatOpened = true;
        }
      } catch { /* continue */ }
    }

    await page.waitForTimeout(2000);

    if (!chatOpened) {
      console.log(`     ⚠️  Could not find Amelia chat bubble`);
    }

    await page.screenshot({ path: '/tmp/amelia-after-login.png' });
    console.log(`     Screenshot: /tmp/amelia-after-login.png`);
  } catch (err) {
    console.error(`     ❌ Login failed:`, err);
    await page.screenshot({ path: '/tmp/amelia-login-error.png' });
    throw err;
  }
}

// ── Widget Interaction ────────────────────────────────────────────────────────

async function waitForWidget(page: Page, config: ITestConfig): Promise<void> {
  const selectors = { ...DEFAULT_SELECTORS, ...(config.selectors ?? {}) };

  console.log('   Trying to find chat input...');

  // Strategy 1: Direct DOM (most common)
  try {
    await page.waitForSelector(selectors.input, { timeout: 5000 });
    console.log('   Found input in main DOM');
    return;
  } catch { console.log('   Not in main DOM'); }

  // Strategy 2: Check ALL iframes
  try {
    const frames = page.frames();
    console.log(`   Checking ${frames.length} frames...`);
    for (const frame of frames) {
      try {
        const input = await frame.$(selectors.input);
        if (input) {
          console.log(`   Found input in frame: ${frame.url()}`);
          // Store the frame reference for later use
          (page as any)._ameliaFrame = frame;
          return;
        }
      } catch { /* continue */ }
    }
  } catch { console.log('   Frame search failed'); }

  // Strategy 3: Look for Amelia iframe specifically
  try {
    const iframeCount = await page.locator('iframe').count();
    console.log(`   Found ${iframeCount} iframes on page`);
    for (let i = 0; i < iframeCount; i++) {
      const iframe = page.locator('iframe').nth(i);
      const src = await iframe.getAttribute('src') ?? '';
      const id = await iframe.getAttribute('id') ?? '';
      const cls = await iframe.getAttribute('class') ?? '';
      console.log(`   iframe[${i}]: src="${src.slice(0, 60)}" id="${id}" class="${cls}"`);

      try {
        const frame = page.frameLocator(`iframe >> nth=${i}`);
        const input = frame.locator('input[placeholder*="message" i], textarea[placeholder*="message" i], input[type="text"]');
        const count = await input.count();
        if (count > 0) {
          console.log(`   Found ${count} inputs in iframe[${i}]`);
          (page as any)._ameliaFrameIndex = i;
          return;
        }
      } catch { /* continue */ }
    }
  } catch (e) { console.log(`   iframe scan error: ${e}`); }

  // Strategy 4: Shadow DOM
  try {
    const found = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const els = doc.querySelectorAll('*');
      for (const el of els) {
        if (el.shadowRoot) {
          const input = el.shadowRoot.querySelector('input[placeholder*="message" i], textarea');
          if (input) return true;
        }
      }
      return false;
    });
    if (found) {
      console.log('   Found in shadow DOM');
      return;
    }
  } catch { /* continue */ }

  // Strategy 5: Wait longer and try again
  console.log('   Waiting 5s and retrying...');
  await page.waitForTimeout(5000);
  try {
    await page.waitForSelector(selectors.input, { timeout: 5000 });
    console.log('   Found after wait');
    return;
  } catch { /* fall through */ }

  // Last resort
  await page.screenshot({ path: '/tmp/amelia-not-found.png' });

  // Dump all inputs on the page for debugging
  const allInputs = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    const inputs = doc.querySelectorAll('input, textarea');
    return Array.from(inputs).map((el: any) => ({
      tag: el.tagName,
      type: el.type,
      placeholder: el.placeholder,
      id: el.id,
      name: el.name,
      className: el.className?.substring?.(0, 50),
      visible: el.offsetParent !== null,
    }));
  });
  console.log('   All inputs on page:', JSON.stringify(allInputs, null, 2));

  throw new Error('Could not find Amelia widget. Screenshot saved to /tmp/amelia-not-found.png');
}

async function sendAndCapture(
  page: Page,
  question: string,
  expectedBehavior: string | undefined,
  config: ITestConfig,
): Promise<IExternalTestResult> {
  const selectors = { ...DEFAULT_SELECTORS, ...(config.selectors ?? {}) };
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
    const doc = (globalThis as any).document;
    const sels = [
      '.bot-message', '.assistant-message', '.amelia-message',
      '[class*="bot"]', '[class*="assistant"]',
      '.message-bubble:not(.user)', '.chat-bubble:not(.user)',
    ];
    let max = 0;
    for (const sel of sels) {
      const count = doc.querySelectorAll(sel).length;
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
    const text = await page.evaluate((prevCount: number) => {
      const doc = (globalThis as any).document;
      const sels = [
        '.bot-message', '.assistant-message', '.amelia-message',
        '[class*="message-text"]', '.message-content',
        '.chat-bubble:not(.user-message)',
      ];

      for (const sel of sels) {
        const msgs = doc.querySelectorAll(sel);
        if (msgs.length > prevCount) {
          const last = msgs[msgs.length - 1];
          return last.textContent?.trim() ?? '';
        }
      }

      const container = doc.querySelector('.chat-messages, .message-list, .amelia-chat');
      if (container) {
        return container.textContent?.trim() ?? null;
      }

      return null;
    }, beforeCount);

    if (text && text.length > 0) {
      // Wait a bit more for the full response to render
      await page.waitForTimeout(1500);

      // Re-capture to get the complete text
      const finalText = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const sels = [
          '.bot-message:last-child', '.assistant-message:last-child',
          '.amelia-message:last-child', '[class*="message-text"]:last-child',
        ];
        for (const sel of sels) {
          const el = doc.querySelector(sel);
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
    login: (getArg(args, '--username') || getArg(args, '--office-id')) ? {
      officeId: getArg(args, '--office-id'),
      username: getArg(args, '--username'),
      password: getArg(args, '--password'),
    } : undefined,
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
