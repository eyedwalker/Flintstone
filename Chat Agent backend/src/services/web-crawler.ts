/**
 * Server-side web crawler.
 * Fetches pages from a seed URL, follows same-host links up to a configurable
 * depth/page limit, strips HTML to clean text, and returns all page content.
 */

export interface ICrawlResult {
  url: string;
  title: string;
  text: string;
  depth: number;
}

export interface ICrawlOptions {
  maxPages: number;
  maxDepth: number;
  /** Timeout per page fetch in ms (default 10s) */
  pageTimeout?: number;
  /** Called after each page is crawled with (pagesCrawled, queueSize) */
  onProgress?: (crawled: number, queued: number) => void | Promise<void>;
}

const DEFAULT_OPTIONS: ICrawlOptions = {
  maxPages: 50,
  maxDepth: 3,
  pageTimeout: 10_000,
};

/**
 * Crawl a website starting from seedUrl.
 * Follows same-host links up to maxDepth levels, stops after maxPages.
 */
export async function crawl(
  seedUrl: string,
  options?: Partial<ICrawlOptions>,
): Promise<ICrawlResult[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const seed = new URL(seedUrl);
  const visited = new Set<string>();
  const results: ICrawlResult[] = [];
  const queue: { url: string; depth: number }[] = [{ url: normalizeUrl(seedUrl), depth: 0 }];

  while (queue.length > 0 && results.length < opts.maxPages) {
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    if (item.depth > opts.maxDepth) continue;
    visited.add(item.url);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.pageTimeout);

      const res = await fetch(item.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'BedrockChatBot/1.0 (Knowledge Base Crawler)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) continue;

      const html = await res.text();
      const title = extractTitle(html);
      const text = htmlToText(html);

      // Skip empty or very short pages
      if (text.trim().length < 50) continue;

      results.push({ url: item.url, title, text, depth: item.depth });

      // Report progress
      if (opts.onProgress) {
        await opts.onProgress(results.length, queue.length);
      }

      // Extract links and enqueue same-host ones
      if (item.depth < opts.maxDepth && results.length < opts.maxPages) {
        const links = extractLinks(html, item.url);
        for (const link of links) {
          try {
            const parsed = new URL(link);
            if (parsed.hostname !== seed.hostname) continue;
            const normalized = normalizeUrl(link);
            if (!visited.has(normalized) && !queue.some(q => q.url === normalized)) {
              queue.push({ url: normalized, depth: item.depth + 1 });
            }
          } catch { /* invalid URL, skip */ }
        }
      }
    } catch {
      // Fetch failed (timeout, network error), skip this page
      continue;
    }
  }

  return results;
}

/** Compose a single crawled page into its own text document for S3 ingestion. */
export function composePageDocument(page: ICrawlResult): string {
  return [
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    `Depth: ${page.depth}`,
    '',
    page.text,
  ].join('\n');
}

/** Compose all crawled pages into a single text document for S3 ingestion. */
export function composeCrawlDocument(seedUrl: string, pages: ICrawlResult[]): string {
  const lines: string[] = [
    `Website: ${seedUrl}`,
    `Pages crawled: ${pages.length}`,
    `Crawled at: ${new Date().toISOString()}`,
    '',
    '='.repeat(80),
    '',
  ];

  for (const page of pages) {
    lines.push(`URL: ${page.url}`);
    lines.push(`Title: ${page.title}`);
    lines.push('-'.repeat(60));
    lines.push(page.text);
    lines.push('');
    lines.push('='.repeat(80));
    lines.push('');
  }

  return lines.join('\n');
}

// ── HTML parsing helpers (pure string-based, no external deps) ───────────────

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1].trim()) : '';
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const hrefRegex = /<a\s[^>]*href\s*=\s*["']([^"'#]+)/gi;
  let m;
  while ((m = hrefRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(m[1], baseUrl).href;
      links.push(resolved);
    } catch { /* skip invalid */ }
  }
  return links;
}

function htmlToText(html: string): string {
  let text = html;

  // Remove script, style, nav, header, footer tags and content
  text = text.replace(/<(script|style|nav|header|footer|noscript|iframe|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = decodeEntities(text);

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  text = text.trim();

  return text;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&bull;/g, '\u2022')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&copy;/g, '\u00A9')
    .replace(/&reg;/g, '\u00AE')
    .replace(/&trade;/g, '\u2122');
}

function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  // Remove trailing slash for consistency (except root)
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.href;
}
