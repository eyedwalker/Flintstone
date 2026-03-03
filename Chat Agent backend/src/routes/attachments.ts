import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { ok, badRequest, notFound, serverError, unauthorized } from '../response';
import { requireRole, IRequestContext } from '../auth';
import * as ddb from '../services/dynamo';
import * as hipaaS3 from '../services/hipaa-s3';
import { findAssistantByApiKey } from './widget-chat';
import { v4 as uuidv4 } from 'uuid';

const ATTACHMENTS_TABLE = process.env['ATTACHMENTS_TABLE'] ?? '';
const ASSISTANTS_TABLE = process.env['ASSISTANTS_TABLE'] ?? '';

interface IAttachment {
  id: string;
  escalationId: string;
  assistantId: string;
  tenantId: string;
  fileName: string;
  contentType: string;
  fileSize?: number;
  s3Key: string;
  status: 'pending' | 'uploaded' | 'confirmed' | 'error';
  createdAt: string;
  updatedAt: string;
}

/**
 * Authenticated admin endpoints for viewing attachments.
 */
export async function handleAttachments(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  query: Record<string, string>,
  ctx: IRequestContext,
): Promise<APIGatewayProxyResultV2> {
  try {
    if (!requireRole(ctx, 'admin')) {
      return unauthorized('Admin role required');
    }

    // GET /attachments?escalationId=xxx — list attachments for an escalation
    if (method === 'GET' && path === '/attachments') {
      const escalationId = query['escalationId'];
      if (!escalationId) return badRequest('escalationId is required');

      const items = await ddb.queryItems<IAttachment>(
        ATTACHMENTS_TABLE,
        'escalationId = :e',
        { ':e': escalationId },
        undefined,
        'escalationId-index',
      );

      return ok({ success: true, data: items });
    }

    // GET /attachments/:id/download-url — get a time-limited download URL
    if (method === 'GET' && path.endsWith('/download-url') && params['id']) {
      const attachment = await ddb.getItem<IAttachment>(ATTACHMENTS_TABLE, { id: params['id'] });
      if (!attachment) return notFound('Attachment not found');
      if (attachment.tenantId !== ctx.organizationId) return unauthorized();

      const downloadUrl = await hipaaS3.getHipaaDownloadUrl(attachment.s3Key, 900);
      return ok({ success: true, data: { downloadUrl, expiresIn: 900 } });
    }

    return notFound('Attachment route not found');
  } catch (e) {
    console.error('Attachments error', e);
    return serverError(String(e));
  }
}

/**
 * Public widget endpoint — get presigned upload URL for HIPAA bucket.
 * Authenticated via x-api-key header.
 */
export async function handleWidgetAttachmentUrl(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const fileName = String(body['fileName'] ?? '').trim();
    const contentType = String(body['contentType'] ?? '').trim();
    const escalationId = String(body['escalationId'] ?? '').trim();

    if (!fileName || !contentType) return badRequest('fileName and contentType are required');

    // Validate content type (images and videos only)
    if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
      return badRequest('Only image and video files are allowed');
    }

    // Look up assistant by API key (uses GSI with scan fallback)
    const assistant = await findAssistantByApiKey(apiKey) as {
      id: string; tenantId: string; apiKey: string;
    } | null;
    if (!assistant) return unauthorized('Invalid API key');

    const attachmentId = uuidv4();
    const ext = fileName.split('.').pop() ?? '';
    const s3Key = `attachments/${assistant.tenantId}/${attachmentId}${ext ? '.' + ext : ''}`;

    // Create attachment record
    const now = new Date().toISOString();
    await ddb.putItem(ATTACHMENTS_TABLE, {
      id: attachmentId,
      escalationId: escalationId || '',
      assistantId: assistant.id,
      tenantId: assistant.tenantId,
      fileName,
      contentType,
      s3Key,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    const uploadUrl = await hipaaS3.getHipaaUploadUrl(s3Key, contentType);

    return ok({
      success: true,
      data: { attachmentId, uploadUrl, s3Key },
    });
  } catch (e) {
    console.error('Widget attachment URL error', e);
    return serverError(String(e));
  }
}

/**
 * Public widget endpoint — confirm upload + trigger EXIF stripping.
 * Authenticated via x-api-key header.
 */
export async function handleWidgetAttachmentConfirm(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const apiKey = headers['x-api-key'] ?? headers['X-Api-Key'] ?? '';
    if (!apiKey) return unauthorized('Missing API key');

    const attachmentId = String(body['attachmentId'] ?? '').trim();
    if (!attachmentId) return badRequest('attachmentId is required');

    // Verify API key (uses GSI with scan fallback)
    const assistant2 = await findAssistantByApiKey(apiKey);
    if (!assistant2) return unauthorized('Invalid API key');

    const attachment = await ddb.getItem<IAttachment>(ATTACHMENTS_TABLE, { id: attachmentId });
    if (!attachment) return notFound('Attachment not found');

    // Strip EXIF metadata for image files
    if (attachment.contentType.startsWith('image/')) {
      try {
        await hipaaS3.stripExifMetadata(attachment.s3Key);
      } catch (e) {
        console.warn('EXIF stripping failed (non-fatal)', e);
      }
    }

    // Mark as confirmed
    await ddb.updateItem(ATTACHMENTS_TABLE, { id: attachmentId }, {
      status: 'confirmed',
      updatedAt: new Date().toISOString(),
    });

    return ok({ success: true, data: { attachmentId, status: 'confirmed' } });
  } catch (e) {
    console.error('Widget attachment confirm error', e);
    return serverError(String(e));
  }
}
