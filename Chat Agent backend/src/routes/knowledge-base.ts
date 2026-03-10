import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import * as s3 from '../services/s3';
import * as kb from '../services/bedrock-kb';
import * as videoIngest from '../services/video-ingest';
import * as webCrawler from '../services/web-crawler';
import { ok, created, noContent, badRequest, notFound, serverError } from '../response';
import { IRequestContext, requireRole, parseBody } from '../auth';
import { forbidden } from '../response';

const CONTENT_TABLE = process.env['CONTENT_TABLE'] ?? '';
const BUCKET = process.env['S3_CONTENT_BUCKET'] ?? '';
const KB_DEFS_TABLE = process.env['KNOWLEDGE_BASES_TABLE'] ?? '';

/** Resolve Vimeo token — checks assistant first, then KB definition (for shared KBs) */
async function resolveVimeoToken(assistantId: string, kbDefId?: string): Promise<string> {
  // Try assistant record first
  if (assistantId && assistantId !== 'kb-shared') {
    const asst = await ddb.getItem<{ vimeoAccessToken?: string }>(
      process.env['ASSISTANTS_TABLE'] ?? '', { id: assistantId }
    );
    if (asst?.vimeoAccessToken) return asst.vimeoAccessToken;
  }
  // Fallback: look up from KB definition by its ID
  if (kbDefId && KB_DEFS_TABLE) {
    const kbDef = await ddb.getItem<{ vimeoAccessToken?: string }>(KB_DEFS_TABLE, { id: kbDefId });
    if (kbDef?.vimeoAccessToken) return kbDef.vimeoAccessToken;
  }
  return '';
}

interface IContentItem {
  id: string;
  assistantId: string;
  tenantId: string;
  name: string;
  type: 'file' | 'url' | 'youtube' | 'vimeo';
  scope: string;
  /** 0=everyone, 1=authenticated, 2=staff, 3=doctor, 4=admin */
  minRoleLevel: number;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  s3Key?: string;
  sourceUrl?: string;
  dataSourceId?: string;
  ingestionJobId?: string;
  knowledgeBaseId?: string;
  fileSize?: number;
  bdaEnabled?: boolean;
  tags?: string[];
  crawlProgress?: {
    phase: 'crawling' | 'uploading' | 'ingesting';
    pagesCrawled: number;
    pagesQueued?: number;
    pagesUploaded?: number;
  };
  errorMessage?: string;
  videoMetadata?: {
    platform: string;
    videoId: string;
    thumbnailUrl: string;
    duration: number;
    description?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export async function handleKnowledgeBase(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  const tenantId = ctx.organizationId;
  try {
    // Read operations require viewer, write operations require editor
    if (method !== 'GET' && !requireRole(ctx, 'editor')) return forbidden('Editor role required');
    // GET /knowledge-base/content?assistantId=xxx or ?knowledgeBaseId=xxx
    if (method === 'GET' && path.endsWith('/content')) {
      const assistantId = query['assistantId'];
      const knowledgeBaseId = query['knowledgeBaseId'];
      if (!assistantId && !knowledgeBaseId) return badRequest('assistantId or knowledgeBaseId query param required');

      let items: IContentItem[];
      if (knowledgeBaseId) {
        items = await ddb.queryItems<IContentItem>(
          CONTENT_TABLE,
          'knowledgeBaseId = :k',
          { ':k': knowledgeBaseId },
          undefined,
          'knowledgeBaseId-index'
        );
      } else {
        items = await ddb.queryItems<IContentItem>(
          CONTENT_TABLE,
          '#a = :a',
          { ':a': assistantId! },
          { '#a': 'assistantId' },
          'assistantId-index'
        );
      }
      return ok(items);
    }

    // POST /knowledge-base/upload-url
    if (method === 'POST' && path.endsWith('/upload-url')) {
      const b = parseBody<{
        fileName: string; contentType: string;
        assistantId: string; knowledgeBaseId: string; scope: string;
        minRoleLevel?: number; fileSize?: number;
      }>(JSON.stringify(body));
      if (!b?.fileName || !b?.contentType || !b?.assistantId) {
        return badRequest('fileName, contentType, assistantId required');
      }
      const contentId = uuidv4();
      const s3Key = `${tenantId}/${b.assistantId}/${contentId}/${b.fileName}`;
      const uploadUrl = await s3.getUploadUrl(s3Key, b.contentType);

      // Pre-create the content record in DynamoDB so progress is trackable
      const now = new Date().toISOString();
      const contentItem: IContentItem = {
        id: contentId,
        assistantId: b.assistantId,
        tenantId,
        name: b.fileName,
        type: 'file',
        scope: b.scope ?? 'tenant',
        minRoleLevel: typeof b.minRoleLevel === 'number' ? b.minRoleLevel : 0,
        status: 'uploading',
        s3Key,
        fileSize: typeof b.fileSize === 'number' ? b.fileSize : undefined,
        knowledgeBaseId: b.knowledgeBaseId,
        createdAt: now,
        updatedAt: now,
      };
      await ddb.putItem(CONTENT_TABLE, contentItem as unknown as Record<string, unknown>);

      return ok({ uploadUrl, contentId, s3Key });
    }

    // POST /knowledge-base/sync  — trigger ingestion after upload
    if (method === 'POST' && path.endsWith('/sync')) {
      const b = parseBody<{
        contentId: string; knowledgeBaseId: string;
        assistantId: string; useBDA?: boolean;
      }>(JSON.stringify(body));
      if (!b?.contentId || !b?.knowledgeBaseId || !b?.assistantId) {
        return badRequest('contentId, knowledgeBaseId, assistantId required');
      }
      const item = await ddb.getItem<IContentItem>(CONTENT_TABLE, { id: b.contentId });
      if (!item || !item.s3Key) return notFound('Content item not found');

      // Write Bedrock metadata file alongside the document so role filtering works at query time.
      // Bedrock reads {s3Key}.metadata.json during ingestion and attaches the attributes to every chunk.
      const metadataKey = `${item.s3Key}.metadata.json`;
      await s3.putJsonObject(metadataKey, {
        metadataAttributes: {
          minRoleLevel: item.minRoleLevel ?? 0,
          scope: item.scope ?? 'tenant',
          contentId: item.id,
          assistantId: item.assistantId,
        },
      });

      const useBDA = b.useBDA === true;
      const bucketArn = `arn:aws:s3:::${BUCKET}`;
      const prefix = item.s3Key;
      const dsRes = await kb.createS3DataSource(b.knowledgeBaseId, item.name, bucketArn, prefix, useBDA);
      const jobRes = await kb.startIngestionJob(b.knowledgeBaseId, dsRes.dataSourceId);

      await ddb.updateItem(CONTENT_TABLE, { id: b.contentId }, {
        status: 'processing',
        dataSourceId: dsRes.dataSourceId,
        ingestionJobId: jobRes.ingestionJobId,
        bdaEnabled: useBDA || undefined,
        updatedAt: new Date().toISOString(),
      });

      return ok({ dataSourceId: dsRes.dataSourceId, ingestionJobId: jobRes.ingestionJobId });
    }

    // POST /knowledge-base/ingest-url — accept immediately, crawl async in provision Lambda
    if (method === 'POST' && path.endsWith('/ingest-url')) {
      const b = parseBody<{
        url: string; assistantId: string; knowledgeBaseId: string;
        title?: string; scope?: string; minRoleLevel?: number; crawlDepth?: number;
        maxPages?: number; useBDA?: boolean;
      }>(JSON.stringify(body));
      if (!b?.url || !b?.assistantId || !b?.knowledgeBaseId) {
        return badRequest('url, assistantId, knowledgeBaseId required');
      }

      const maxDepth = Math.min(Math.max(b.crawlDepth ?? 2, 1), 5);
      const maxPagesMap: Record<number, number> = { 1: 10, 2: 50, 3: 200, 4: 500, 5: 1000 };
      const maxPages = b.maxPages ?? maxPagesMap[maxDepth] ?? 50;

      // Create content record immediately so the UI can show progress
      const contentId = uuidv4();
      const siteTitle = b.title ?? new URL(b.url).hostname;
      const now = new Date().toISOString();
      const contentItem: IContentItem = {
        id: contentId,
        assistantId: b.assistantId,
        tenantId,
        name: siteTitle,
        type: 'url',
        scope: b.scope ?? 'tenant',
        minRoleLevel: typeof b.minRoleLevel === 'number' ? b.minRoleLevel : 0,
        status: 'processing',
        sourceUrl: b.url,
        knowledgeBaseId: b.knowledgeBaseId,
        bdaEnabled: b.useBDA === true || undefined,
        createdAt: now,
        updatedAt: now,
      };
      await ddb.putItem(CONTENT_TABLE, contentItem as unknown as Record<string, unknown>);

      // Fire-and-forget: invoke the provision Lambda asynchronously to do the crawl
      const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
      const lambda = new LambdaClient({ region: process.env['REGION'] ?? 'us-west-2' });
      await lambda.send(new InvokeCommand({
        FunctionName: process.env['PROVISION_FUNCTION_NAME'] ?? 'chat-agent-provision-dev',
        InvocationType: 'Event', // async — returns immediately
        Payload: Buffer.from(JSON.stringify({
          _crawlJob: {
            contentId,
            url: b.url,
            tenantId,
            assistantId: b.assistantId,
            knowledgeBaseId: b.knowledgeBaseId,
            maxDepth,
            maxPages,
            scope: b.scope ?? 'tenant',
            minRoleLevel: b.minRoleLevel ?? 0,
            useBDA: b.useBDA === true,
          },
        })),
      }));

      return created(contentItem);
    }

    // POST /knowledge-base/ingest-video — fetch transcript + AI summary and ingest as text
    if (method === 'POST' && path.endsWith('/ingest-video')) {
      const b = parseBody<{
        url: string; assistantId: string; knowledgeBaseId: string;
        scope?: string; minRoleLevel?: number; useBDA?: boolean;
      }>(JSON.stringify(body));
      if (!b?.url || !b?.assistantId || !b?.knowledgeBaseId) {
        return badRequest('url, assistantId, knowledgeBaseId required');
      }

      const detected = videoIngest.detectVideoUrl(b.url);
      if (!detected) return badRequest('URL is not a recognized Vimeo or YouTube video');

      // Get Vimeo access token from assistant or KB definition
      let vimeoToken = '';
      if (detected.platform === 'vimeo') {
        vimeoToken = await resolveVimeoToken(b.assistantId, (b as any).kbDefId);
        if (!vimeoToken) return badRequest('No Vimeo access token configured');
      }

      // Fetch transcript and metadata
      const raw = detected.platform === 'vimeo'
        ? await videoIngest.fetchVimeoContent(detected.videoId, vimeoToken)
        : await videoIngest.fetchYouTubeContent(detected.videoId);

      // Generate AI summary
      const summary = await videoIngest.summarizeWithBedrock(raw.title, raw.transcript);
      const content: videoIngest.IVideoContent = { ...raw, summary };

      // Compose and upload text document to S3
      const contentId = uuidv4();
      const fileName = `video-${detected.videoId}.txt`;
      const s3Key = `${tenantId}/${b.assistantId}/${contentId}/${fileName}`;
      await s3.putObject(s3Key, videoIngest.composeVideoDocument(content), 'text/plain');

      // Write Bedrock metadata file
      await s3.putJsonObject(`${s3Key}.metadata.json`, {
        metadataAttributes: {
          minRoleLevel: b.minRoleLevel ?? 0,
          scope: b.scope ?? 'tenant',
          contentId,
          assistantId: b.assistantId,
          platform: detected.platform,
          videoId: detected.videoId,
          sourceUrl: content.sourceUrl,
        },
      });

      // Create S3 data source and start ingestion
      const useBDA = b.useBDA === true;
      const bucketArn = `arn:aws:s3:::${BUCKET}`;
      const dsRes = await kb.createS3DataSource(b.knowledgeBaseId, `video-${contentId}`, bucketArn, s3Key, useBDA);
      const jobRes = await kb.startIngestionJob(b.knowledgeBaseId, dsRes.dataSourceId);

      const now = new Date().toISOString();
      const contentItem: IContentItem = {
        id: contentId,
        assistantId: b.assistantId,
        tenantId,
        name: content.title,
        type: detected.platform,
        scope: b.scope ?? 'tenant',
        minRoleLevel: typeof b.minRoleLevel === 'number' ? b.minRoleLevel : 0,
        status: 'processing',
        sourceUrl: content.sourceUrl,
        s3Key,
        knowledgeBaseId: b.knowledgeBaseId,
        dataSourceId: dsRes.dataSourceId,
        ingestionJobId: jobRes.ingestionJobId,
        bdaEnabled: useBDA || undefined,
        videoMetadata: {
          platform: detected.platform,
          videoId: detected.videoId,
          thumbnailUrl: content.thumbnailUrl,
          duration: content.duration,
          description: content.description || undefined,
        },
        createdAt: now,
        updatedAt: now,
      };
      await ddb.putItem(CONTENT_TABLE, contentItem as unknown as Record<string, unknown>);
      return created(contentItem);
    }

    // GET /knowledge-base/jobs/:kbId/:dsId/:jobId
    if (method === 'GET' && path.includes('/jobs/')) {
      const segments = path.split('/');
      const kbId = params['kbId'] ?? segments[segments.length - 3];
      const dsId = params['dsId'] ?? segments[segments.length - 2];
      const jobId = params['jobId'] ?? segments[segments.length - 1];
      const status = await kb.getIngestionJob(kbId, dsId, jobId);
      return ok(status);
    }

    // POST /knowledge-base/vimeo/folders — list Vimeo folders/projects
    if (method === 'POST' && path.endsWith('/vimeo/folders')) {
      const b = parseBody<{ assistantId: string; kbDefId?: string }>(JSON.stringify(body));
      if (!b?.assistantId) return badRequest('assistantId required');

      const token = await resolveVimeoToken(b.assistantId, b.kbDefId);
      if (!token) return badRequest('No Vimeo access token configured');

      const result = await videoIngest.listFolders(token);
      return ok(result);
    }

    // POST /knowledge-base/vimeo/browse — list videos from Vimeo account
    if (method === 'POST' && path.endsWith('/vimeo/browse')) {
      const b = parseBody<{ assistantId: string; kbDefId?: string; page?: number; perPage?: number; query?: string; folderId?: string }>(JSON.stringify(body));
      if (!b?.assistantId) return badRequest('assistantId required');

      const token = await resolveVimeoToken(b.assistantId, b.kbDefId);
      if (!token) return badRequest('No Vimeo access token configured');

      // Load exclude keywords from KB definition or assistant
      let excludeKeywords: string[] | undefined;
      if (b.kbDefId && KB_DEFS_TABLE) {
        const kbDef = await ddb.getItem<{ vimeoExcludeKeywords?: string[] }>(KB_DEFS_TABLE, { id: b.kbDefId });
        if (kbDef?.vimeoExcludeKeywords?.length) excludeKeywords = kbDef.vimeoExcludeKeywords;
      } else if (b.assistantId && b.assistantId !== 'kb-shared') {
        const asst = await ddb.getItem<{ vimeoExcludeKeywords?: string[] }>(
          process.env['ASSISTANTS_TABLE'] ?? '', { id: b.assistantId }
        );
        if (asst?.vimeoExcludeKeywords?.length) excludeKeywords = asst.vimeoExcludeKeywords;
      }

      const result = await videoIngest.listAccountVideos(token, b.page ?? 1, b.perPage ?? 25, b.query, b.folderId, excludeKeywords);

      // Cross-reference with existing content to mark already-imported videos
      const existing = await ddb.queryItems<IContentItem>(
        CONTENT_TABLE, '#a = :a', { ':a': b.assistantId },
        { '#a': 'assistantId' }, 'assistantId-index'
      );
      const importedVideoIds = new Set(
        existing.filter(i => i.type === 'vimeo' && i.videoMetadata?.videoId)
          .map(i => i.videoMetadata!.videoId)
      );

      const videosWithStatus = result.videos.map(v => ({
        ...v,
        alreadyImported: importedVideoIds.has(v.videoId),
      }));

      return ok({ ...result, videos: videosWithStatus });
    }

    // POST /knowledge-base/vimeo/bulk-ingest — import multiple Vimeo videos
    if (method === 'POST' && path.endsWith('/vimeo/bulk-ingest')) {
      const b = parseBody<{
        assistantId: string; knowledgeBaseId: string; kbDefId?: string;
        videoIds: string[]; scope?: string; minRoleLevel?: number; useBDA?: boolean;
      }>(JSON.stringify(body));
      if (!b?.assistantId || !b?.knowledgeBaseId || !b?.videoIds?.length)
        return badRequest('assistantId, knowledgeBaseId, videoIds required');

      const token = await resolveVimeoToken(b.assistantId, b.kbDefId);
      if (!token) return badRequest('No Vimeo access token configured');

      const results: { videoId: string; contentId?: string; error?: string }[] = [];

      for (const videoId of b.videoIds) {
        try {
          const raw = await videoIngest.fetchVimeoContent(videoId, token);
          const summary = await videoIngest.summarizeWithBedrock(raw.title, raw.transcript);
          const content: videoIngest.IVideoContent = { ...raw, summary };

          const contentId = uuidv4();
          const fileName = `video-${videoId}.txt`;
          const s3Key = `${tenantId}/${b.assistantId}/${contentId}/${fileName}`;
          await s3.putObject(s3Key, videoIngest.composeVideoDocument(content), 'text/plain');

          await s3.putJsonObject(`${s3Key}.metadata.json`, {
            metadataAttributes: {
              minRoleLevel: b.minRoleLevel ?? 0,
              scope: b.scope ?? 'tenant',
              contentId, assistantId: b.assistantId,
              platform: 'vimeo', videoId, sourceUrl: content.sourceUrl,
            },
          });

          const useBDA = b.useBDA === true;
          const bucketArn = `arn:aws:s3:::${BUCKET}`;
          const dsRes = await kb.createS3DataSource(b.knowledgeBaseId, `video-${contentId}`, bucketArn, s3Key, useBDA);
          const jobRes = await kb.startIngestionJob(b.knowledgeBaseId, dsRes.dataSourceId);

          const now = new Date().toISOString();
          const item: IContentItem = {
            id: contentId, assistantId: b.assistantId, tenantId,
            name: content.title, type: 'vimeo',
            scope: b.scope ?? 'tenant',
            minRoleLevel: typeof b.minRoleLevel === 'number' ? b.minRoleLevel : 0,
            status: 'processing', sourceUrl: content.sourceUrl, s3Key,
            knowledgeBaseId: b.knowledgeBaseId,
            dataSourceId: dsRes.dataSourceId, ingestionJobId: jobRes.ingestionJobId,
            bdaEnabled: useBDA || undefined,
            videoMetadata: {
              platform: 'vimeo', videoId,
              thumbnailUrl: content.thumbnailUrl,
              duration: content.duration,
              description: content.description || undefined,
            },
            createdAt: now, updatedAt: now,
          };
          await ddb.putItem(CONTENT_TABLE, item as unknown as Record<string, unknown>);
          results.push({ videoId, contentId });
        } catch (e: any) {
          results.push({ videoId, error: e?.message ?? String(e) });
        }
      }

      return ok({ results, total: b.videoIds.length, succeeded: results.filter(r => r.contentId).length });
    }

    // POST /knowledge-base/check-status — poll Bedrock job statuses for processing items
    if (method === 'POST' && path.endsWith('/check-status')) {
      const b = parseBody<{ assistantId: string }>(JSON.stringify(body));
      if (!b?.assistantId) return badRequest('assistantId required');

      const items = await ddb.queryItems<IContentItem>(
        CONTENT_TABLE, '#a = :a', { ':a': b.assistantId },
        { '#a': 'assistantId' }, 'assistantId-index'
      );
      const processing = items.filter((i) => i.status === 'processing');
      const STALE_MS = 60 * 60 * 1000; // 1 hour

      for (const item of processing) {
        // If missing required IDs, mark as error if stuck for over 1 hour
        if (!item.knowledgeBaseId || !item.dataSourceId || !item.ingestionJobId) {
          const age = Date.now() - new Date(item.createdAt).getTime();
          if (age > STALE_MS) {
            await ddb.updateItem(CONTENT_TABLE, { id: item.id }, {
              status: 'error',
              errorMessage: 'Ingestion never started — missing data source or job ID',
              updatedAt: new Date().toISOString(),
            });
          }
          continue;
        }

        try {
          const job = await kb.getIngestionJob(item.knowledgeBaseId, item.dataSourceId, item.ingestionJobId);
          if (job.status === 'COMPLETE') {
            await ddb.updateItem(CONTENT_TABLE, { id: item.id }, {
              status: 'ready', updatedAt: new Date().toISOString(),
            });
          } else if (job.status === 'FAILED' || job.status === 'STOPPED') {
            await ddb.updateItem(CONTENT_TABLE, { id: item.id }, {
              status: 'error',
              errorMessage: `Ingestion ${job.status.toLowerCase()}`,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch {
          // Job may no longer exist — mark as error if stale
          const age = Date.now() - new Date(item.createdAt).getTime();
          if (age > STALE_MS) {
            await ddb.updateItem(CONTENT_TABLE, { id: item.id }, {
              status: 'error',
              errorMessage: 'Ingestion job no longer exists',
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      const updated = await ddb.queryItems<IContentItem>(
        CONTENT_TABLE, '#a = :a', { ':a': b.assistantId },
        { '#a': 'assistantId' }, 'assistantId-index'
      );
      return ok(updated);
    }

    // POST /knowledge-base/content/bulk-delete
    if (method === 'POST' && path.endsWith('/bulk-delete')) {
      const b = parseBody<{ ids: string[] }>(JSON.stringify(body));
      if (!b?.ids?.length) return badRequest('ids array required');

      let deleted = 0;
      for (const itemId of b.ids) {
        try {
          const item = await ddb.getItem<IContentItem>(CONTENT_TABLE, { id: itemId });
          if (!item) continue;
          if (item.s3Key) await s3.deleteObject(item.s3Key);
          await ddb.deleteItem(CONTENT_TABLE, { id: itemId });
          deleted++;
        } catch { /* continue */ }
      }

      return ok({ deleted, total: b.ids.length });
    }

    const id = params['id'];

    // POST /knowledge-base/content/:id/retry
    if (method === 'POST' && path.endsWith('/retry') && id) {
      const item = await ddb.getItem<IContentItem>(CONTENT_TABLE, { id });
      if (!item || !item.knowledgeBaseId) return notFound();
      if (item.status !== 'error') return badRequest('Only failed items can be retried');

      if (item.dataSourceId) {
        try { await kb.deleteDataSource(item.knowledgeBaseId, item.dataSourceId); } catch { /* ok */ }
      }

      let dsRes;
      const bucketArn = `arn:aws:s3:::${BUCKET}`;
      const useBDA = item.bdaEnabled === true;

      if (item.type === 'url' && !item.s3Key) {
        // URL item without S3 content — re-crawl and upload one file per page
        const pages = await webCrawler.crawl(item.sourceUrl!, { maxDepth: 2, maxPages: 50 });
        if (pages.length === 0) return badRequest('Could not fetch any content from this URL');
        const s3Prefix = `${item.tenantId}/${item.assistantId}/${item.id}/`;
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          const pageDoc = webCrawler.composePageDocument(page);
          const pageKey = `${s3Prefix}page-${String(i).padStart(4, '0')}.txt`;
          await s3.putObject(pageKey, pageDoc, 'text/plain');
          await s3.putJsonObject(`${pageKey}.metadata.json`, {
            metadataAttributes: {
              minRoleLevel: item.minRoleLevel ?? 0,
              scope: item.scope ?? 'tenant',
              contentId: item.id,
              assistantId: item.assistantId,
              sourceUrl: page.url,
              pageTitle: page.title,
            },
          });
        }
        await ddb.updateItem(CONTENT_TABLE, { id }, { s3Key: s3Prefix });
        dsRes = await kb.createS3DataSource(item.knowledgeBaseId, `url-${item.id}`, bucketArn, s3Prefix, useBDA);
      } else {
        dsRes = await kb.createS3DataSource(
          item.knowledgeBaseId, item.name, bucketArn, item.s3Key!, useBDA
        );
      }

      const jobRes = await kb.startIngestionJob(item.knowledgeBaseId, dsRes.dataSourceId);

      await ddb.updateItem(CONTENT_TABLE, { id }, {
        status: 'processing',
        dataSourceId: dsRes.dataSourceId,
        ingestionJobId: jobRes.ingestionJobId,
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      });

      return ok({ dataSourceId: dsRes.dataSourceId, ingestionJobId: jobRes.ingestionJobId });
    }

    // PATCH /knowledge-base/content/:id — edit content metadata
    if ((method === 'PATCH' || method === 'PUT') && id && path.includes('/content/')) {
      const item = await ddb.getItem<IContentItem>(CONTENT_TABLE, { id });
      if (!item) return notFound();

      const b = parseBody<{
        title?: string; tags?: string[]; scope?: string; minRoleLevel?: number;
      }>(JSON.stringify(body));

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (b?.title !== undefined) updates.name = b.title;
      if (b?.tags !== undefined) updates.tags = b.tags;
      if (b?.scope !== undefined) updates.scope = b.scope;
      if (b?.minRoleLevel !== undefined) updates.minRoleLevel = b.minRoleLevel;

      await ddb.updateItem(CONTENT_TABLE, { id }, updates);

      if ((b?.scope !== undefined || b?.minRoleLevel !== undefined) && item.s3Key) {
        const metadataKey = `${item.s3Key}.metadata.json`;
        await s3.putJsonObject(metadataKey, {
          metadataAttributes: {
            minRoleLevel: b?.minRoleLevel ?? item.minRoleLevel ?? 0,
            scope: b?.scope ?? item.scope ?? 'tenant',
            contentId: item.id,
            assistantId: item.assistantId,
          },
        });
      }

      return ok({ ...item, ...updates });
    }

    // GET /knowledge-base/content/:id/preview — view stored S3 content
    if (method === 'GET' && id && path.endsWith('/preview')) {
      const item = await ddb.getItem<IContentItem>(CONTENT_TABLE, { id });
      if (!item) return notFound();

      if (!item.s3Key) return ok({ files: [], totalFiles: 0 });

      // If s3Key ends with '/', it's a directory (crawled URL with per-page files)
      if (item.s3Key.endsWith('/')) {
        const objects = await s3.listObjects(item.s3Key);
        const textFiles = objects.filter(o => o.key.endsWith('.txt'));
        // Read up to 20 page files for preview (avoid massive responses)
        const maxPreview = parseInt(query['limit'] ?? '20', 10);
        const offset = parseInt(query['offset'] ?? '0', 10);
        const slice = textFiles.slice(offset, offset + maxPreview);

        const MAX_TEXT_CHARS = 3000; // Truncate preview text to avoid massive payloads
        const files = await Promise.all(slice.map(async (obj) => {
          try {
            const text = await s3.getObject(obj.key);
            const truncated = text.length > MAX_TEXT_CHARS;
            return {
              key: obj.key.replace(item.s3Key!, ''),
              size: obj.size,
              text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
              truncated,
              fullSize: text.length,
            };
          } catch (e) {
            return {
              key: obj.key.replace(item.s3Key!, ''),
              size: obj.size,
              text: '',
              truncated: false,
              fullSize: 0,
              error: 'Failed to read file',
            };
          }
        }));

        return ok({ files, totalFiles: textFiles.length, offset, limit: maxPreview });
      }

      // Single file
      const text = await s3.getObject(item.s3Key);
      return ok({ files: [{ key: item.s3Key.split('/').pop(), size: text.length, text }], totalFiles: 1 });
    }

    // DELETE /knowledge-base/content/:id
    if (method === 'DELETE' && id) {
      const item = await ddb.getItem<IContentItem>(CONTENT_TABLE, { id });
      if (!item) return notFound();
      if (item.s3Key) await s3.deleteObject(item.s3Key);
      await ddb.deleteItem(CONTENT_TABLE, { id });
      return noContent();
    }

    return notFound();
  } catch (e) {
    console.error('knowledge-base handler error', e);
    return serverError(String(e));
  }
}
