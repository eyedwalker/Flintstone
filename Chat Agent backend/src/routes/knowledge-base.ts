import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import * as s3 from '../services/s3';
import * as kb from '../services/bedrock-kb';
import { ok, created, noContent, badRequest, notFound, serverError } from '../response';
import { parseBody } from '../auth';

const CONTENT_TABLE = process.env['CONTENT_TABLE'] ?? '';
const BUCKET = process.env['S3_CONTENT_BUCKET'] ?? '';

interface IContentItem {
  id: string;
  assistantId: string;
  tenantId: string;
  name: string;
  type: 'file' | 'url' | 'youtube' | 'vimeo';
  scope: string;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  s3Key?: string;
  sourceUrl?: string;
  dataSourceId?: string;
  ingestionJobId?: string;
  knowledgeBaseId?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export async function handleKnowledgeBase(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  tenantId: string
): Promise<APIGatewayProxyResultV2> {
  try {
    // GET /knowledge-base/content?assistantId=xxx
    if (method === 'GET' && path.endsWith('/content')) {
      const assistantId = query['assistantId'];
      if (!assistantId) return badRequest('assistantId query param required');
      const items = await ddb.queryItems<IContentItem>(
        CONTENT_TABLE,
        '#a = :a',
        { ':a': assistantId },
        { '#a': 'assistantId' },
        'assistantId-index'
      );
      return ok(items);
    }

    // POST /knowledge-base/upload-url
    if (method === 'POST' && path.endsWith('/upload-url')) {
      const b = parseBody<{
        fileName: string; contentType: string;
        assistantId: string; knowledgeBaseId: string; scope: string;
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
        status: 'uploading',
        s3Key,
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
        assistantId: string;
      }>(JSON.stringify(body));
      if (!b?.contentId || !b?.knowledgeBaseId || !b?.assistantId) {
        return badRequest('contentId, knowledgeBaseId, assistantId required');
      }
      const item = await ddb.getItem<IContentItem>(CONTENT_TABLE, { id: b.contentId });
      if (!item || !item.s3Key) return notFound('Content item not found');

      const bucketArn = `arn:aws:s3:::${BUCKET}`;
      const prefix = item.s3Key;
      const dsRes = await kb.createS3DataSource(b.knowledgeBaseId, item.name, bucketArn, prefix);
      const jobRes = await kb.startIngestionJob(b.knowledgeBaseId, dsRes.dataSourceId);

      await ddb.updateItem(CONTENT_TABLE, { id: b.contentId }, {
        status: 'processing',
        dataSourceId: dsRes.dataSourceId,
        ingestionJobId: jobRes.ingestionJobId,
        updatedAt: new Date().toISOString(),
      });

      return ok({ dataSourceId: dsRes.dataSourceId, ingestionJobId: jobRes.ingestionJobId });
    }

    // POST /knowledge-base/ingest-url
    if (method === 'POST' && path.endsWith('/ingest-url')) {
      const b = parseBody<{
        url: string; type: 'url' | 'youtube' | 'vimeo';
        assistantId: string; knowledgeBaseId: string; dataSourceId: string;
        name?: string; scope?: string;
      }>(JSON.stringify(body));
      if (!b?.url || !b?.assistantId || !b?.knowledgeBaseId || !b?.dataSourceId) {
        return badRequest('url, assistantId, knowledgeBaseId, dataSourceId required');
      }
      const now = new Date().toISOString();
      const contentItem: IContentItem = {
        id: uuidv4(),
        assistantId: b.assistantId,
        tenantId,
        name: b.name ?? b.url,
        type: b.type ?? 'url',
        scope: b.scope ?? 'tenant',
        status: 'processing',
        sourceUrl: b.url,
        knowledgeBaseId: b.knowledgeBaseId,
        dataSourceId: b.dataSourceId,
        createdAt: now,
        updatedAt: now,
      };
      await ddb.putItem(CONTENT_TABLE, contentItem as unknown as Record<string, unknown>);
      const jobRes = await kb.startIngestionJob(b.knowledgeBaseId, b.dataSourceId);
      await ddb.updateItem(CONTENT_TABLE, { id: contentItem.id }, {
        ingestionJobId: jobRes.ingestionJobId,
        updatedAt: new Date().toISOString(),
      });
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

    // DELETE /knowledge-base/content/:id
    const id = params['id'];
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
