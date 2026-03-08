import { v4 as uuidv4 } from 'uuid';
import * as ddb from './dynamo';
import * as s3 from './s3';
import { invokeModel } from './bedrock-chat';

const CONTENT_TABLE = process.env['CONTENT_TABLE'] ?? '';
const SCREEN_MAPPINGS_TABLE = process.env['SCREEN_MAPPINGS_TABLE'] ?? '';

// ── Types ────────────────────────────────────────────────────────

interface IParsedScreen {
  screenName: string;
  section: string;
  urlPattern: string;
  purpose: string;
  keyElements: string;
  commonTasks: string;
}

interface IVideoDoc {
  title: string;
  url: string;
  vimeoId: string;
  product: string;
  summary: string;
}

interface IScreenVideo {
  title: string;
  url: string;
  vimeoId: string;
  relevanceScore: number;
  reason: string;
  pinned: boolean;
}

interface IHelpArticle {
  title: string;
  url: string;
}

interface IScreenHelpArticle {
  title: string;
  url: string;
  relevanceScore: number;
}

interface IScreenMapping {
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
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ── URL Guide Parser ─────────────────────────────────────────────

function parseUrlGuide(text: string): IParsedScreen[] {
  const screens: IParsedScreen[] = [];
  const lines = text.split('\n');

  let currentSection = '';
  let currentScreen: Partial<IParsedScreen> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Section headers: ## markdown, "SECTION N:" dividers, or lines before === underlines
    const sectionMatch = line.match(/^#{1,3}\s+(?:\d+\.\s*)?(.+)/)
      || line.match(/^SECTION\s+\d+:\s*(.+)/i);
    if (!sectionMatch && line.match(/^[A-Z]/) && lines[i + 1]?.match(/^={4,}/)) {
      // Line before === underline is a section header
      currentSection = line.replace(/[*_]/g, '').trim();
      i++; // skip the === line
      continue;
    }
    if (sectionMatch && !line.includes('Screen Name') && !line.includes('URL Pattern') && !line.match(/^Screen:/i)) {
      const nextLines = lines.slice(i + 1, i + 5).join(' ');
      if (!nextLines.includes('URL Pattern:') && !nextLines.includes('Screen Name:') && !nextLines.match(/Screen:/i)) {
        currentSection = (sectionMatch[1] || line).replace(/[*_]/g, '').trim();
        continue;
      }
    }

    // Screen name line — matches "Screen Name:", "Screen:", bold variants, or bullet items
    const screenNameMatch = line.match(/^\*?\*?Screen(?:\s+Name)?:?\*?\*?\s*(.+)/i)
      || line.match(/^[-•]\s*\*?\*?(.+?)\*?\*?\s*$/);
    if (screenNameMatch && lines[i + 1]?.includes('URL Pattern')) {
      if (currentScreen?.screenName) {
        screens.push(currentScreen as IParsedScreen);
      }
      currentScreen = {
        screenName: screenNameMatch[1].replace(/[*_]/g, '').trim(),
        section: currentSection,
        urlPattern: '',
        purpose: '',
        keyElements: '',
        commonTasks: '',
      };
      continue;
    }

    if (!currentScreen) continue;

    if (line.match(/^[-•]?\s*\*?\*?URL Pattern:?\*?\*?\s*/i)) {
      currentScreen.urlPattern = line.replace(/^[-•]?\s*\*?\*?URL Pattern:?\*?\*?\s*/i, '').trim();
    } else if (line.match(/^[-•]?\s*\*?\*?Purpose:?\*?\*?\s*/i)) {
      currentScreen.purpose = line.replace(/^[-•]?\s*\*?\*?Purpose:?\*?\*?\s*/i, '').trim();
    } else if (line.match(/^[-•]?\s*\*?\*?Key (?:Elements|Fields):?\*?\*?\s*/i)) {
      currentScreen.keyElements = line.replace(/^[-•]?\s*\*?\*?Key (?:Elements|Fields):?\*?\*?\s*/i, '').trim();
    } else if (line.match(/^[-•]?\s*\*?\*?(?:Common Tasks|Features):?\*?\*?\s*/i)) {
      // Append features to commonTasks since the data model doesn't have a separate field
      const val = line.replace(/^[-•]?\s*\*?\*?(?:Common Tasks|Features):?\*?\*?\s*/i, '').trim();
      currentScreen.commonTasks = currentScreen.commonTasks ? `${currentScreen.commonTasks}; ${val}` : val;
    }
  }

  // Push last screen
  if (currentScreen?.screenName) {
    screens.push(currentScreen as IParsedScreen);
  }

  return screens;
}

/** Convert URL pattern like /patient/{id}/demographics to regex */
function patternToRegex(pattern: string): string {
  return pattern
    .replace(/\{[^}]+\}/g, '[^/]+')  // {id} → [^/]+
    .replace(/\//g, '\\/');           // escape slashes
}

// ── Video Index Builder ──────────────────────────────────────────

function parseVideoDoc(text: string): IVideoDoc | null {
  const titleMatch = text.match(/^Title:\s*(.+)/m);
  const urlMatch = text.match(/^Video URL:\s*(https?:\/\/\S+)/m);
  const productMatch = text.match(/^Product:\s*(.+)/m);
  if (!titleMatch || !urlMatch) return null;

  const vimeoIdMatch = urlMatch[1].match(/vimeo\.com\/(\d+)/);
  const vimeoId = vimeoIdMatch ? vimeoIdMatch[1] : '';

  // Extract a brief summary from AI analysis
  const summaryMatch = text.match(/COMPREHENSIVE SUMMARY[:\s-]*\n([\s\S]*?)(?:\n[A-Z]{3,}|\n---|\n\n\n)/);
  const summary = summaryMatch
    ? summaryMatch[1].trim().slice(0, 500)
    : text.slice(0, 300);

  return {
    title: titleMatch[1].trim(),
    url: urlMatch[1].trim(),
    vimeoId,
    product: productMatch ? productMatch[1].trim() : 'Unknown',
    summary,
  };
}

async function loadVideoIndex(assistantId: string): Promise<IVideoDoc[]> {
  const contentItems = await ddb.queryItems<{
    id: string; assistantId: string; type: string; s3Key?: string; status: string;
  }>(CONTENT_TABLE, '#a = :a', { ':a': assistantId }, { '#a': 'assistantId' }, 'assistantId-index');

  const videoItems = contentItems.filter(
    (i) => (i.type === 'vimeo' || i.type === 'youtube') && i.status === 'ready' && i.s3Key
  );

  const videos: IVideoDoc[] = [];
  for (const item of videoItems) {
    try {
      if (item.s3Key!.endsWith('/')) {
        // Directory-based video library — read all .txt files inside
        const objects = await s3.listObjects(item.s3Key!);
        const txtFiles = objects.filter((o) => o.key.endsWith('.txt'));
        console.log(`Video library directory: ${txtFiles.length} transcript files`);
        // Sample up to 200 videos for matching (reading all 1400+ would be too slow)
        const sample = txtFiles.length > 200
          ? txtFiles.filter((_, idx) => idx % Math.ceil(txtFiles.length / 200) === 0)
          : txtFiles;
        for (const file of sample) {
          try {
            const text = await s3.getObject(file.key);
            const parsed = parseVideoDoc(text);
            if (parsed) videos.push(parsed);
          } catch { /* skip */ }
        }
      } else {
        const text = await s3.getObject(item.s3Key!);
        const parsed = parseVideoDoc(text);
        if (parsed) videos.push(parsed);
      }
    } catch {
      // Skip unreadable items
    }
  }
  console.log(`Loaded ${videos.length} video docs for matching`);
  return videos;
}

async function loadHelpArticles(assistantId: string): Promise<IHelpArticle[]> {
  const contentItems = await ddb.queryItems<{
    id: string; assistantId: string; type: string; s3Key?: string; status: string; sourceUrl?: string;
  }>(CONTENT_TABLE, '#a = :a', { ':a': assistantId }, { '#a': 'assistantId' }, 'assistantId-index');

  const urlItems = contentItems.filter(
    (i) => i.type === 'url' && i.status === 'ready' && i.s3Key?.endsWith('/')
  );

  const articles: IHelpArticle[] = [];
  for (const item of urlItems) {
    try {
      const objects = await s3.listObjects(item.s3Key!);
      const metaFiles = objects.filter((o) => o.key.endsWith('.metadata.json'));
      for (const meta of metaFiles) {
        try {
          const raw = await s3.getObject(meta.key);
          const parsed = JSON.parse(raw);
          const attrs = parsed.metadataAttributes || parsed;
          if (attrs.sourceUrl && attrs.pageTitle) {
            articles.push({ title: attrs.pageTitle, url: attrs.sourceUrl });
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  console.log(`Loaded ${articles.length} help articles for matching`);
  return articles;
}

async function loadUrlGuide(assistantId: string): Promise<string | null> {
  const contentItems = await ddb.queryItems<{
    id: string; assistantId: string; name: string; s3Key?: string; status: string;
  }>(CONTENT_TABLE, '#a = :a', { ':a': assistantId }, { '#a': 'assistantId' }, 'assistantId-index');

  const guide = contentItems.find(
    (i) => i.status === 'ready' && i.s3Key
      && (i.name.toLowerCase().includes('url') || i.name.toLowerCase().includes('screen mapping'))
  );

  if (!guide?.s3Key) return null;

  // If s3Key ends with /, read first text file inside
  if (guide.s3Key.endsWith('/')) {
    const objects = await s3.listObjects(guide.s3Key);
    const txt = objects.find((o) => o.key.endsWith('.txt'));
    if (!txt) return null;
    return s3.getObject(txt.key);
  }
  return s3.getObject(guide.s3Key);
}

// ── AI Matching ──────────────────────────────────────────────────

async function matchVideosToScreen(
  screen: IParsedScreen,
  videos: IVideoDoc[],
  helpArticles: IHelpArticle[],
): Promise<{ videos: IScreenVideo[]; helpArticles: IScreenHelpArticle[]; trendingQuestions: string[] }> {
  // Build a compact video list for the prompt
  const videoList = videos
    .map((v, i) => `[V${i}] "${v.title}" (Product: ${v.product}) — ${v.summary.slice(0, 200)}`)
    .join('\n');

  const articleList = helpArticles
    .map((a, i) => `[A${i}] "${a.title}" — ${a.url}`)
    .join('\n');

  const prompt = `You are mapping training videos AND help articles to an application screen.

SCREEN:
- Name: ${screen.screenName}
- Section: ${screen.section}
- URL: ${screen.urlPattern}
- Purpose: ${screen.purpose}
- Key Elements: ${screen.keyElements}
- Common Tasks: ${screen.commonTasks}

AVAILABLE VIDEOS:
${videoList}

AVAILABLE HELP ARTICLES:
${articleList}

INSTRUCTIONS:
1. Select the top 5 most relevant VIDEOS for this screen. If fewer are relevant, select only the relevant ones.
2. Select the top 5 most relevant HELP ARTICLES for this screen.
3. Generate 3-5 contextual trending questions that a user on this screen might ask.
4. For each trending question, if a help article directly answers it, include the article index.

Respond in JSON only (no markdown):
{
  "videos": [
    { "index": 0, "relevanceScore": 85, "reason": "Directly covers patient demographics entry" }
  ],
  "articles": [
    { "index": 0, "relevanceScore": 90 }
  ],
  "trendingQuestions": [
    "How do I update patient insurance information?",
    "How do I merge duplicate patient records?"
  ]
}`;

  try {
    const response = await invokeModel(
      'You are a helpful assistant that maps training videos to application screens. Always respond with valid JSON only.',
      prompt,
    );

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { videos: [], helpArticles: [], trendingQuestions: [] };

    const parsed = JSON.parse(jsonMatch[0]);

    const matchedVideos: IScreenVideo[] = (parsed.videos || [])
      .filter((v: any) => typeof v.index === 'number' && v.index < videos.length)
      .map((v: any) => ({
        title: videos[v.index].title,
        url: videos[v.index].url,
        vimeoId: videos[v.index].vimeoId,
        relevanceScore: v.relevanceScore ?? 50,
        reason: v.reason ?? '',
        pinned: false,
      }));

    const matchedArticles: IScreenHelpArticle[] = (parsed.articles || [])
      .filter((a: any) => typeof a.index === 'number' && a.index < helpArticles.length)
      .map((a: any) => ({
        title: helpArticles[a.index].title,
        url: helpArticles[a.index].url,
        relevanceScore: a.relevanceScore ?? 50,
      }));

    return {
      videos: matchedVideos,
      helpArticles: matchedArticles,
      trendingQuestions: (parsed.trendingQuestions || []).map((q: any) =>
        typeof q === 'string' ? q : q.question ?? q.text ?? String(q),
      ),
    };
  } catch (e) {
    console.error(`AI matching failed for screen ${screen.screenName}:`, e);
    return { videos: [], helpArticles: [], trendingQuestions: [] };
  }
}

// ── Main Generator ───────────────────────────────────────────────

export async function generateMappings(
  assistantId: string,
  tenantId: string,
): Promise<{ count: number }> {
  // 1. Load URL guide and parse screens
  const guideText = await loadUrlGuide(assistantId);
  if (!guideText) throw new Error('No URL/Screen Mapping guide found in knowledge base content');

  const screens = parseUrlGuide(guideText);
  if (screens.length === 0) throw new Error('Could not parse any screens from the URL mapping guide');

  // 2. Load video index and help articles
  const videos = await loadVideoIndex(assistantId);
  const helpArticles = await loadHelpArticles(assistantId);
  console.log(`Screen mapping: ${screens.length} screens, ${videos.length} videos, ${helpArticles.length} help articles`);

  // 3. Load existing mappings to preserve reviewed/custom ones
  const existing = await ddb.queryItems<IScreenMapping>(
    SCREEN_MAPPINGS_TABLE, '#a = :a', { ':a': assistantId },
    { '#a': 'assistantId' }, 'assistantId-index'
  );
  const preservedMap = new Map<string, IScreenMapping>();
  for (const m of existing) {
    if (m.status === 'reviewed' || m.status === 'custom') {
      preservedMap.set(m.screenName, m);
    }
  }

  // 4. Delete existing ai-generated mappings
  for (const m of existing) {
    if (m.status === 'ai-generated') {
      await ddb.deleteItem(SCREEN_MAPPINGS_TABLE, { id: m.id });
    }
  }

  // 5. Process screens in batches
  const BATCH_SIZE = 5;
  let created = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < screens.length; i += BATCH_SIZE) {
    const batch = screens.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map((screen) => {
        // Skip if preserved
        if (preservedMap.has(screen.screenName)) return null;
        return matchVideosToScreen(screen, videos, helpArticles);
      })
    );

    for (let j = 0; j < batch.length; j++) {
      const screen = batch[j];

      // Skip preserved
      if (preservedMap.has(screen.screenName)) {
        created++;
        continue;
      }

      const result = results[j];
      const mapping: IScreenMapping = {
        id: uuidv4(),
        assistantId,
        tenantId,
        screenName: screen.screenName,
        section: screen.section,
        urlPattern: screen.urlPattern,
        urlRegex: patternToRegex(screen.urlPattern),
        purpose: screen.purpose,
        videos: result?.videos ?? [],
        helpArticles: result?.helpArticles ?? [],
        trendingQuestions: result?.trendingQuestions ?? [],
        status: 'ai-generated',
        createdAt: now,
        updatedAt: now,
      };

      await ddb.putItem(SCREEN_MAPPINGS_TABLE, mapping as unknown as Record<string, unknown>);
      created++;
    }

    // Small delay between batches to be nice to Bedrock
    if (i + BATCH_SIZE < screens.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { count: created };
}
