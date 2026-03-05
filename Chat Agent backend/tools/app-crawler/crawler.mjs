#!/usr/bin/env node
/**
 * Encompass App Crawler — Angular Material aware
 * 1. Opens each nav dropdown to discover hrefs
 * 2. Navigates directly to each discovered path
 * 3. Captures screenshots + DOM metadata
 * 4. Runs Claude Vision for analysis
 * 5. Generates KB document and uploads to S3
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'crawl-config.json'), 'utf-8'));

const PASSWORD = process.env.ENCOMPASS_PASSWORD;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!PASSWORD) { console.error('Set ENCOMPASS_PASSWORD'); process.exit(1); }

const SCREENSHOT_DIR = path.join(__dirname, config.screenshotDir);
const OUTPUT_DIR = path.join(__dirname, config.outputDir);
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const flags = new Set(process.argv.slice(2));
const runAll = flags.size === 0;
const doDiscover = runAll || flags.has('--discover');
const doAnalyze = runAll || flags.has('--analyze');
const doUpload = runAll || flags.has('--upload');

// ─── Login ──────────────────────────────────────────────────────────────────

async function login(page) {
  await page.goto(config.baseUrl + config.auth.loginUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.fill('#practiceLocationId', config.auth.officeId);
  await page.fill('#loginName', config.auth.username);
  await page.fill('#password', PASSWORD);
  await page.evaluate(() => {
    ['practiceLocationId', 'loginName', 'password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await page.click('#btnLogin');
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log('Logged in:', page.url());
}

// ─── Discover all nav routes ────────────────────────────────────────────────

async function discoverRoutes(page) {
  console.log('\nDiscovering navigation routes...\n');

  const navLabels = ['Patients', 'Appointments', 'Orders', 'Catalog', 'Claim Management', 'Inventory', 'Reporting'];
  const topBarLabels = ['Store Operations', 'Help', 'Admin in 999'];
  const routes = [];

  // Add home
  routes.push({ path: '/', name: 'Home Dashboard', module: 'Front Office' });

  for (const label of [...navLabels, ...topBarLabels]) {
    try {
      // Click to open dropdown
      await page.click(`button:has-text("${label}")`, { timeout: 5000 });
      await page.waitForTimeout(800);

      // Collect dropdown menu items (Angular Material)
      const items = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.mat-mdc-menu-item, .cdk-overlay-pane a')).map(el => ({
          text: el.textContent.trim(),
          href: el.getAttribute('href'),
        })).filter(i => i.href && i.text);
      });

      for (const item of items) {
        routes.push({ path: item.href, name: item.text, module: label });
        console.log(`  ${label} > ${item.text} → ${item.href}`);
      }

      // Close dropdown
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

    } catch (err) {
      console.log(`  Could not open ${label}: ${err.message.substring(0, 80)}`);
    }
  }

  // Also discover tile links from home page
  await page.goto(config.baseUrl + '/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const tileLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]')).map(a => ({
      text: a.textContent.trim(), href: a.getAttribute('href')
    })).filter(l => l.href && l.text && !l.href.includes('login') && !l.href.includes('logout') && l.href.startsWith('/'));
  });
  for (const tile of tileLinks) {
    if (!routes.find(r => r.path === tile.href)) {
      routes.push({ path: tile.href, name: tile.text, module: 'Home Tile' });
      console.log(`  Tile: ${tile.text} → ${tile.href}`);
    }
  }

  console.log(`\nDiscovered ${routes.length} routes total.`);
  return routes;
}

// ─── Capture Page ───────────────────────────────────────────────────────────

async function capturePage(page, route) {
  const safeName = route.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().substring(0, 60);
  const screenshotPath = path.join(SCREENSHOT_DIR, `${safeName}.png`);
  const metaPath = path.join(OUTPUT_DIR, `${safeName}.json`);

  console.log(`  Capturing: ${route.name} (${route.path})`);

  try {
    await page.goto(config.baseUrl + route.path, { waitUntil: 'networkidle', timeout: 30000 });
  } catch {
    await page.goto(config.baseUrl + route.path, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }
  await page.waitForTimeout(3000);

  if (page.url().includes('/login')) {
    console.log(`    Redirected to login — skipping`);
    return null;
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });

  const metadata = await page.evaluate(() => {
    const data = { pageTitle: document.title, breadcrumb: '', formFields: [], buttons: [], headings: [], tableHeaders: [], visibleText: '' };

    const bc = document.querySelector('nav[aria-label="breadcrumb"], .breadcrumb, ol.breadcrumb');
    if (bc) {
      const parts = [];
      bc.querySelectorAll('li, span, a').forEach(el => { const t = el.textContent.trim(); if (t && !parts.includes(t)) parts.push(t); });
      data.breadcrumb = parts.join(' > ');
    }

    document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(el => {
      const label = el.getAttribute('aria-label') || el.getAttribute('placeholder')
        || (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() : null) || el.name || '';
      if (label) data.formFields.push({ label: label.substring(0, 100), type: el.type || 'text' });
    });

    document.querySelectorAll('button, [role="button"]').forEach(el => {
      const text = (el.textContent || '').trim();
      if (text && text.length > 1 && text.length < 100) data.buttons.push(text);
    });

    document.querySelectorAll('h1, h2, h3, h4, h5').forEach(h => {
      const t = h.textContent.trim();
      if (t && t.length < 200) data.headings.push({ level: h.tagName, text: t });
    });

    document.querySelectorAll('table').forEach(table => {
      const headers = [];
      table.querySelectorAll('th').forEach(th => headers.push(th.textContent.trim()));
      if (headers.length > 0) data.tableHeaders.push(headers);
    });

    data.visibleText = document.body.innerText.substring(0, 3000);
    return data;
  });

  const result = { url: page.url(), module: route.module, screenName: route.name, path: route.path, screenshotFile: `${safeName}.png`, ...metadata, capturedAt: new Date().toISOString() };
  fs.writeFileSync(metaPath, JSON.stringify(result, null, 2));
  console.log(`    Title: ${metadata.pageTitle} | Forms: ${metadata.formFields.length}, Buttons: ${metadata.buttons.length}`);
  return result;
}

// ─── Crawl ──────────────────────────────────────────────────────────────────

async function crawl() {
  console.log('=== Phase 1: Crawl & Capture ===\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await login(page);
    const routes = await discoverRoutes(page);
    const allResults = [];
    const captured = new Set();

    for (const route of routes) {
      if (captured.has(route.path)) continue;
      captured.add(route.path);
      try {
        const result = await capturePage(page, route);
        if (result) allResults.push(result);
      } catch (err) {
        console.error(`    ERROR: ${err.message.substring(0, 100)}`);
      }
    }

    const manifest = { crawledAt: new Date().toISOString(), baseUrl: config.baseUrl, totalPages: allResults.length,
      pages: allResults.map(r => ({ screenName: r.screenName, module: r.module, url: r.url, path: r.path, screenshotFile: r.screenshotFile })) };
    fs.writeFileSync(path.join(OUTPUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`\n=== Crawl complete: ${allResults.length} pages captured ===`);
    return allResults;
  } finally {
    await browser.close();
  }
}

// ─── Phase 2: Claude Vision ─────────────────────────────────────────────────

async function analyzeWithClaude(screenshotPath, metadata) {
  if (!ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY'); process.exit(1); }
  const base64Image = fs.readFileSync(screenshotPath).toString('base64');

  const prompt = `You are analyzing a screen from Encompass/Eyefinity, an eye care practice management application by VSP.

Screen: "${metadata.screenName}"
Module: ${metadata.module}
URL: ${metadata.url}
Page Title: ${metadata.pageTitle}
Breadcrumb: ${metadata.breadcrumb || 'N/A'}
Headings: ${metadata.headings?.map(h => h.text).join(', ') || 'N/A'}
Form Fields: ${metadata.formFields?.map(f => f.label).join(', ') || 'None'}
Buttons: ${metadata.buttons?.slice(0, 20).join(', ') || 'None'}

Provide a detailed knowledge base entry. Format EXACTLY as:

SCREEN NAME: [Name]
MODULE: [Module]
URL PATTERN: ${metadata.path || metadata.url}

PURPOSE:
[2-3 sentences describing what this screen is for]

KEY FEATURES:
- [Feature 1]
- [Feature 2]
(list all visible features)

COMMON USER TASKS:
1. [Task description]
2. [Task description]
(3-7 tasks)

STEP-BY-STEP: [Most common task]
1. [Step]
2. [Step]

NAVIGATION:
- How to get here: [navigation path]
- Accessible from here: [list related screens]

TIPS AND NOTES:
- [Any important tips, warnings, or notes about this screen]`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Image } },
        { type: 'text', text: prompt },
      ]}] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  return (await res.json()).content[0].text;
}

async function analyzeAll() {
  console.log('\n=== Phase 2: Claude Vision Analysis ===\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, '_manifest.json'), 'utf-8'));
  const results = [];

  for (const pg of manifest.pages) {
    const safeName = pg.screenName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().substring(0, 60);
    const metaPath = path.join(OUTPUT_DIR, `${safeName}.json`);
    const ssPath = path.join(SCREENSHOT_DIR, pg.screenshotFile);
    const analysisPath = path.join(OUTPUT_DIR, `${safeName}-analysis.txt`);

    if (fs.existsSync(analysisPath)) { results.push({ name: pg.screenName, file: analysisPath }); continue; }
    if (!fs.existsSync(ssPath) || !fs.existsSync(metaPath)) continue;

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta.pageTitle?.toLowerCase().includes('not found')) continue;

    console.log(`Analyzing: ${pg.screenName}...`);
    try {
      const analysis = await analyzeWithClaude(ssPath, meta);
      fs.writeFileSync(analysisPath, analysis);
      results.push({ name: pg.screenName, file: analysisPath });
      console.log(`  Done.`);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ERROR: ${err.message.substring(0, 200)}`);
    }
  }

  const combinedPath = path.join(OUTPUT_DIR, 'encompass-screen-analysis.txt');
  let combined = `ENCOMPASS / EYEFINITY SCREEN ANALYSIS\n${'='.repeat(60)}\nGenerated: ${new Date().toISOString()}\nSource: AI analysis of ${config.baseUrl}\n\n${'='.repeat(60)}\n\n`;
  for (const r of results) {
    if (fs.existsSync(r.file)) combined += fs.readFileSync(r.file, 'utf-8') + '\n\n' + '='.repeat(60) + '\n\n';
  }
  fs.writeFileSync(combinedPath, combined);
  console.log(`\n=== ${results.length} screens analyzed → ${combinedPath} ===`);
  return combinedPath;
}

// ─── Phase 3: Upload ────────────────────────────────────────────────────────

async function upload(docPath) {
  console.log('\n=== Phase 3: Upload to S3 ===\n');
  docPath = docPath || path.join(OUTPUT_DIR, 'encompass-screen-analysis.txt');
  const s3Key = '58b19370-10a1-70b9-584d-f14f731f6963/e7aed27b-0417-4701-ba64-da0dc42b7adc/screen-analysis/encompass-screen-analysis.txt';
  const { execSync } = await import('child_process');
  execSync(`aws s3 cp "${docPath}" "s3://wubba-data-sources/${s3Key}" --profile eyentelligence`, { stdio: 'inherit' });
  console.log('Upload complete.');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Encompass App Crawler\n');
  let docPath;
  if (doDiscover) await crawl();
  if (doAnalyze) docPath = await analyzeAll();
  if (doUpload) await upload(docPath);
  console.log('\nDone!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
