#!/usr/bin/env node
/**
 * amelia-export.mjs — pull conversation data out of Amelia for reporting.
 *
 * Runs the async export flow end to end:
 *   auth -> exportCheck -> export/async/generate -> poll status -> download
 *
 * Usage
 *   node scripts/amelia-export.mjs login                 verify credentials only
 *   node scripts/amelia-export.mjs domains               list domains + their UUIDs
 *   node scripts/amelia-export.mjs export --days 7       pull the last 7 days
 *   node scripts/amelia-export.mjs export --from 2026-08-01 --to 2026-08-04
 *
 * Credentials come from the environment — never hard-code them in this file,
 * and never commit them. Either auth mode works; username/password is tried
 * first if present.
 *
 *   AMELIA_BASE_URL   default https://eyefinity2.amelia.com/AmeliaRest
 *   AMELIA_USERNAME / AMELIA_PASSWORD          (X-Amelia-Rest-Token auth)
 *   AMELIA_CLIENT_ID / AMELIA_CLIENT_SECRET    (OAuth bearer auth)
 *   AMELIA_DOMAIN_ID  domain UUID; omit and the script resolves it from
 *                     AMELIA_DOMAIN (the domain *code*) via `domains`
 *
 * Options
 *   --days N          window ending now (default 7); ignored if --from given
 *   --from / --to     ISO dates (YYYY-MM-DD) or full timestamps
 *   --format csv|json (default csv)
 *   --no-transcripts  omit transcript bodies (much smaller file)
 *   --out PATH        where to write (default ./amelia-export-<from>_<to>.<ext>)
 *   --tz ZONE         IANA zone for day bucketing (default UTC)
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/* ---------- credentials from a gitignored file ---------- */
// Secrets live in `.env.amelia` next to the backend package, which both the
// repo-root and backend .gitignore already exclude via `.env.*`. Anything
// already exported in the real environment wins, so CI can override.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadEnvFile() {
  for (const name of ['.env.amelia', '.env.local', '.env']) {
    const f = path.join(ROOT, name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m) continue;
      const key = m[1];
      // Strip matching quotes but keep any '#' inside a quoted value — Amelia
      // passwords routinely contain # and @.
      let val = m[2].trim();
      if (/^"(.*)"$/s.test(val) || /^'(.*)'$/s.test(val)) val = val.slice(1, -1);
      else val = val.replace(/\s+#.*$/, '').trim();
      if (!(key in process.env)) process.env[key] = val;
    }
    return name;
  }
  return null;
}
const envFile = loadEnvFile();

const BASE = (process.env.AMELIA_BASE_URL || 'https://eyefinity2.amelia.com/AmeliaRest').replace(/\/+$/, '');
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/* ---------- tiny arg parser ---------- */
const argv = process.argv.slice(2);
const cmd = argv.find(a => !a.startsWith('--')) || 'export';
const flag = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const has = name => argv.includes(`--${name}`);

/* ---------- http ---------- */
class AmeliaError extends Error {
  constructor(msg, status, body) { super(msg); this.status = status; this.body = body; }
}

async function req(pathname, { method = 'GET', headers = {}, body, raw = false, auth } = {}) {
  const url = pathname.startsWith('http') ? pathname : `${BASE}${pathname}`;
  const res = await fetch(url, {
    method,
    headers: { ...(auth ? authHeader(auth) : {}), ...headers },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Amelia answers 500 for bad credentials rather than 401 — call that out
    // explicitly so it doesn't read as an outage.
    const hint = res.status === 500 && /auth|login|token/.test(pathname)
      ? ' (Amelia returns 500 for invalid credentials, not 401 — check username/password)'
      : '';
    throw new AmeliaError(`${method} ${pathname} -> ${res.status}${hint}`, res.status, text.slice(0, 400));
  }
  return raw ? res : res.json();
}

const authHeader = ({ token, mode }) =>
  mode === 'bearer' ? { Authorization: `Bearer ${token}` } : { 'X-Amelia-Rest-Token': token };

/* ---------- auth ---------- */
async function authenticate() {
  const { AMELIA_USERNAME: u, AMELIA_PASSWORD: p, AMELIA_CLIENT_ID: id, AMELIA_CLIENT_SECRET: secret } = process.env;

  if (u && p) {
    const out = await req('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    });
    const token = out.token || out.restToken || out.accessToken || out.sessionToken;
    if (!token) throw new AmeliaError(`login succeeded but no token in response: ${Object.keys(out)}`, 200, out);
    return { token, mode: 'token' };
  }

  if (id && secret) {
    const out = await req('/api/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!out.access_token) throw new AmeliaError('oauth returned no access_token', 200, out);
    return { token: out.access_token, mode: 'bearer' };
  }

  throw new Error(
    'No credentials found.\n' +
    `  Create ${path.join(ROOT, '.env.amelia')} (already gitignored) from scripts/amelia.env.example,\n` +
    '  or export AMELIA_USERNAME + AMELIA_PASSWORD in your shell.');
}

/* ---------- domains ---------- */
async function listDomains(auth) {
  // The admin list is the authoritative one; fall back to the conversational
  // list if this token lacks admin scope.
  for (const p of ['/api/v1/admin/domains/', '/api/v1/conversations/domains']) {
    try {
      const out = await req(p, { auth });
      const arr = Array.isArray(out) ? out : out.content || out.data || out.domains || [];
      if (arr.length) return arr;
    } catch (e) {
      if (e.status !== 403 && e.status !== 404) throw e;
    }
  }
  return [];
}

async function resolveDomainId(auth) {
  if (process.env.AMELIA_DOMAIN_ID) return process.env.AMELIA_DOMAIN_ID;
  const code = process.env.AMELIA_DOMAIN;
  if (!code) throw new Error('Set AMELIA_DOMAIN_ID (uuid), or AMELIA_DOMAIN (code) so it can be resolved.');
  const domains = await listDomains(auth);
  const hit = domains.find(d => (d.code || d.domainCode || d.name) === code);
  if (!hit) {
    throw new Error(`Domain code "${code}" not found. Available: ` +
      domains.map(d => d.code || d.domainCode || d.name).join(', '));
  }
  return hit.id || hit.domainId || hit.uuid;
}

/* ---------- export flow ---------- */
function windowRange() {
  const to = flag('to') ? new Date(String(flag('to'))) : new Date();
  const from = flag('from')
    ? new Date(String(flag('from')))
    : new Date(to.getTime() - Number(flag('days', 7)) * 86400000);
  // Amelia wants "M/d/yyyy H:m" (per the OpenAPI param docs — ISO 8601 is
  // rejected with "Unable to parse time values"). Rendered in UTC to match
  // the tz=UTC we send alongside.
  const fmt = d =>
    `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${d.getUTCHours()}:${d.getUTCMinutes()}`;
  return { from: fmt(from), to: fmt(to), fromIso: from.toISOString().slice(0, 10), toIso: to.toISOString().slice(0, 10) };
}

function exportParams(domainId, from, to) {
  const q = new URLSearchParams({
    domainIds: domainId,
    from, to,
    tz: String(flag('tz', 'America/Chicago')),
    includeTranscripts: String(!has('no-transcripts')),
    includeEscalationLogs: 'true',
    // Server 7.3.6.4+ — adds the Executed Cognitive Agents/Functions, topics,
    // token, and Resolution Status columns that the admin-UI export carries.
    // Not in the bundled 7.3.3.2 spec; harmless if an older server ignores it.
    includeAgenticExecutions: 'true',
    includeContexts: 'false',
    useSummaryCreatedDates: 'false',
    useUserLanguage: 'false',
  });
  return q;
}

async function runExport(auth) {
  const domainId = await resolveDomainId(auth);
  const { from, to, fromIso, toIso } = windowRange();
  const format = String(flag('format', 'csv'));
  const q = exportParams(domainId, from, to);

  console.log(`domain   : ${domainId}`);
  console.log(`window   : ${from} -> ${to}`);
  console.log(`format   : ${format}${has('no-transcripts') ? ' (no transcripts)' : ' (with transcripts)'}`);

  // 1. exportCheck — validates the window before committing to a job. Amelia
  // rejects ranges that are too wide here rather than failing halfway through.
  try {
    const check = await req(`/api/v1/admin/metrics/domains/conversations/exportCheck?${q}`, { auth });
    console.log(`check    : ok${check && typeof check === 'object' ? ` ${JSON.stringify(check).slice(0, 120)}` : ''}`);
  } catch (e) {
    console.log(`check    : ${e.message}`);
    if (e.status === 400) throw e; // a 400 here means the window itself is invalid
  }

  // 2. generate — returns a job id
  const genQ = new URLSearchParams(q); genQ.set('format', format);
  const gen = await req(`/api/v1/admin/metrics/domains/conversations/export/async/generate?${genQ}`, { auth });
  const jobId = typeof gen === 'string' ? gen : gen.id || gen.jobId || gen.exportId || gen.data;
  if (!jobId) throw new AmeliaError(`no job id in generate response: ${JSON.stringify(gen).slice(0, 200)}`, 200, gen);
  console.log(`job      : ${jobId}`);

  // 3. poll
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = '';
  for (;;) {
    if (Date.now() > deadline) throw new Error(`export ${jobId} still not ready after ${POLL_TIMEOUT_MS / 60000}m`);
    const st = await req(`/api/v1/admin/metrics/domains/conversations/export/async/${jobId}/status`, { auth });
    const status = String(st.status ?? st.state ?? st).toUpperCase();
    if (status !== last) { process.stdout.write(`\rstatus   : ${status}`.padEnd(40)); last = status; }
    if (/DONE|COMPLETE|READY|SUCCE/.test(status)) break;
    if (/FAIL|ERROR|CANCEL/.test(status)) throw new Error(`export failed: ${JSON.stringify(st).slice(0, 300)}`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  process.stdout.write('\n');

  // 4. download
  const res = await req(`/api/v1/admin/metrics/domains/conversations/export/async/${jobId}/download`,
    { auth, raw: true });
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = format === 'json' ? 'json' : 'csv';
  const out = String(flag('out', `amelia-export-${fromIso}_${toIso}.${ext}`));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`wrote    : ${out} (${(buf.length / 1024).toFixed(1)} KB)`);
  return out;
}

/* ---------- main ---------- */
try {
  console.log(`base     : ${BASE}`);
  if (envFile) console.log(`env      : ${envFile}`);
  const auth = await authenticate();
  console.log(`auth     : ok (${auth.mode})`);

  if (cmd === 'login') {
    // nothing else to do — the point was to prove the credentials work
  } else if (cmd === 'domains') {
    const domains = await listDomains(auth);
    if (!domains.length) console.log('(no domains visible to this account)');
    for (const d of domains) {
      console.log(`  ${(d.id || d.domainId || d.uuid || '?').padEnd(38)} ${d.code || d.domainCode || ''}  ${d.name || ''}`);
    }
  } else if (cmd === 'export') {
    await runExport(auth);
  } else {
    console.error(`unknown command "${cmd}" — use login | domains | export`);
    process.exit(2);
  }
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  if (e.body) console.error(String(e.body).slice(0, 400));
  process.exit(1);
}
