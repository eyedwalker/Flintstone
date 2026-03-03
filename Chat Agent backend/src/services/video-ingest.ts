import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';

const runtimeClient = new BedrockRuntimeClient({ region: process.env['REGION'] ?? 'us-west-2' });
const ssmClient = new SSMClient({ region: process.env['REGION'] ?? 'us-west-2' });

export interface IVideoContent {
  platform: 'vimeo' | 'youtube';
  videoId: string;
  title: string;
  description: string;
  duration: number; // seconds
  thumbnailUrl: string;
  transcript: string;
  summary: string;
  sourceUrl: string;
}

export interface IVimeoVideoItem {
  uri: string;
  videoId: string;
  name: string;
  description: string;
  duration: number;
  thumbnailUrl: string;
  link: string;
  createdTime: string;
}

export interface IVimeoListResult {
  videos: IVimeoVideoItem[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
}

/** List videos from the authenticated Vimeo account */
export async function listAccountVideos(
  accessToken: string, page = 1, perPage = 25, query?: string
): Promise<IVimeoListResult> {
  const params = new URLSearchParams({
    fields: 'uri,name,description,duration,pictures,link,created_time',
    per_page: String(perPage),
    page: String(page),
    sort: 'date',
    direction: 'desc',
  });
  if (query) params.set('query', query);

  const res = await fetch(`https://api.vimeo.com/me/videos?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
    },
  });
  if (!res.ok) throw new Error(`Vimeo API error: ${res.status}`);
  const data: any = await res.json();

  const videos: IVimeoVideoItem[] = (data.data ?? []).map((v: any) => ({
    uri: v.uri,
    videoId: v.uri.replace('/videos/', ''),
    name: v.name ?? '',
    description: v.description ?? '',
    duration: v.duration ?? 0,
    thumbnailUrl: v.pictures?.sizes?.find((s: any) => s.width >= 640)?.link
      ?? v.pictures?.sizes?.[v.pictures.sizes.length - 1]?.link ?? '',
    link: v.link,
    createdTime: v.created_time,
  }));

  return {
    videos,
    total: data.total ?? 0,
    page: data.page ?? page,
    perPage: data.per_page ?? perPage,
    hasMore: data.paging?.next !== null,
  };
}

/** Detect if a URL is a Vimeo or YouTube video; returns null if not */
export function detectVideoUrl(url: string): { platform: 'vimeo' | 'youtube'; videoId: string } | null {
  try {
    const u = new URL(url);

    // Vimeo: vimeo.com/123456 or player.vimeo.com/video/123456
    const vimeoMatch = url.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d+)/);
    if (vimeoMatch) return { platform: 'vimeo', videoId: vimeoMatch[1] };

    // YouTube: youtube.com/watch?v=xxx or youtu.be/xxx or youtube.com/shorts/xxx
    const ytRegex = /(?:youtube\.com\/(?:watch\?.*v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
    const ytMatch = url.match(ytRegex);
    if (ytMatch) return { platform: 'youtube', videoId: ytMatch[1] };

    void u; // suppress unused warning
    return null;
  } catch {
    return null;
  }
}

/** Format seconds as "Xm Ys" */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Strip WebVTT/SRT timestamps and return plain text */
function parseVttToText(vtt: string): string {
  return vtt
    .replace(/WEBVTT.*?\n\n/s, '')
    .replace(/^\d+\n/gm, '')
    .replace(/\d{2}:\d{2}[:.]\d{3} --> \d{2}:\d{2}[:.]\d{3}.*\n/gm, '')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Fetch video content from Vimeo using the API */
export async function fetchVimeoContent(videoId: string, accessToken: string): Promise<Omit<IVideoContent, 'summary'>> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Get metadata
  const metaRes = await fetch(`https://api.vimeo.com/videos/${videoId}?fields=name,description,duration,pictures`, { headers });
  if (!metaRes.ok) throw new Error(`Vimeo metadata fetch failed: ${metaRes.status}`);
  const meta: any = await metaRes.json();

  const title = meta.name ?? `Vimeo Video ${videoId}`;
  const description = meta.description ?? '';
  const duration = meta.duration ?? 0;
  const thumbnailUrl = meta.pictures?.sizes?.find((s: any) => s.width >= 640)?.link
    ?? meta.pictures?.sizes?.[0]?.link ?? '';

  // Get text tracks (transcripts)
  let transcript = '';
  try {
    const trackRes = await fetch(`https://api.vimeo.com/videos/${videoId}/texttracks`, { headers });
    if (trackRes.ok) {
      const tracks: any = await trackRes.json();
      // Prefer English tracks; fall back to first available
      const enTrack = tracks.data?.find((t: any) => t.language?.startsWith('en')) ?? tracks.data?.[0];
      if (enTrack?.link) {
        const vttRes = await fetch(enTrack.link);
        if (vttRes.ok) {
          transcript = parseVttToText(await vttRes.text());
        }
      }
    }
  } catch { /* no transcript available */ }

  return {
    platform: 'vimeo',
    videoId,
    title,
    description,
    duration,
    thumbnailUrl,
    transcript,
    sourceUrl: `https://vimeo.com/${videoId}`,
  };
}

/** Fetch video content from YouTube (public videos only, no API key needed) */
export async function fetchYouTubeContent(videoId: string): Promise<Omit<IVideoContent, 'summary'>> {
  // Fetch page to get title, description, thumbnail
  let title = `YouTube Video ${videoId}`;
  let description = '';
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BedrockBot/1.0)' },
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const titleMatch = html.match(/"title":"([^"]+)"/);
      if (titleMatch) title = titleMatch[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"');
      const descMatch = html.match(/"shortDescription":"([\s\S]*?)(?<!\\)"/);
      if (descMatch) description = descMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').slice(0, 500);
    }
  } catch { /* use defaults */ }

  // Fetch captions via YouTube's timedtext API
  let transcript = '';
  try {
    const captionUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=vtt`;
    const captionRes = await fetch(captionUrl);
    if (captionRes.ok) {
      const vttText = await captionRes.text();
      if (vttText.includes('WEBVTT')) {
        transcript = parseVttToText(vttText);
      }
    }
    // Fallback: auto-generated captions
    if (!transcript) {
      const autoUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=vtt`;
      const autoRes = await fetch(autoUrl);
      if (autoRes.ok) {
        const vttText = await autoRes.text();
        if (vttText.includes('WEBVTT')) transcript = parseVttToText(vttText);
      }
    }
  } catch { /* no transcript available */ }

  return {
    platform: 'youtube',
    videoId,
    title,
    description,
    duration: 0,
    thumbnailUrl,
    transcript,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

/** Generate an AI summary of the video transcript using Claude Haiku */
export async function summarizeWithBedrock(title: string, transcript: string): Promise<string> {
  if (!transcript) return 'No transcript available for this video.';

  const truncated = transcript.slice(0, 8000); // stay within token limits
  const messages = [
    {
      role: 'user',
      content: `Summarize this video transcript for a knowledge base article. Focus on key topics, main points, and takeaways. Write 2-3 concise paragraphs.\n\nVideo title: ${title}\n\nTranscript:\n${truncated}`,
    },
  ];

  try {
    const res = await runtimeClient.send(new InvokeModelCommand({
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ anthropic_version: 'bedrock-2023-05-31', max_tokens: 600, messages }),
    }));
    const out = JSON.parse(new TextDecoder().decode(res.body));
    return out.content?.[0]?.text ?? 'Summary unavailable.';
  } catch {
    return 'Summary could not be generated.';
  }
}

/** Compose the full text document to store in S3 and ingest into the KB */
export function composeVideoDocument(content: IVideoContent): string {
  const lines: string[] = [
    `VIDEO: ${content.title}`,
    `Platform: ${content.platform === 'vimeo' ? 'Vimeo' : 'YouTube'}`,
  ];
  if (content.duration) lines.push(`Duration: ${formatDuration(content.duration)}`);
  lines.push(`Watch URL: ${content.sourceUrl}`);
  lines.push(`[IMPORTANT: When referencing this video, always include the Watch URL so the user can view it]`);
  if (content.description) lines.push(`\nDescription:\n${content.description}`);
  lines.push(`\nSummary:\n${content.summary}`);
  if (content.transcript) lines.push(`\nFull Transcript:\n${content.transcript}`);
  return lines.join('\n');
}

/** Store a Vimeo access token in SSM Parameter Store as a SecureString */
export async function storeVimeoToken(organizationId: string, token: string): Promise<void> {
  const stage = process.env['STAGE'] ?? 'dev';
  const parameterName = `/chat-agent/${stage}/vimeo/${organizationId}/access-token`;

  await ssmClient.send(new PutParameterCommand({
    Name: parameterName,
    Value: token,
    Type: 'SecureString',
    Overwrite: true,
  }));
}

/** Retrieve a Vimeo access token from SSM Parameter Store; returns null if not found */
export async function getVimeoToken(organizationId: string): Promise<string | null> {
  const stage = process.env['STAGE'] ?? 'dev';
  const parameterName = `/chat-agent/${stage}/vimeo/${organizationId}/access-token`;

  try {
    const result = await ssmClient.send(new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    }));
    return result.Parameter?.Value ?? null;
  } catch (err: any) {
    if (err.name === 'ParameterNotFound') return null;
    throw err;
  }
}