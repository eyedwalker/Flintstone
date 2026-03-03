import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import { ok, created, noContent, badRequest, forbidden, notFound, serverError } from '../response';
import { IRequestContext, requireRole, parseBody } from '../auth';

const TABLE = process.env['WIDGET_PRESETS_TABLE'] ?? '';

export interface IWidgetPreset {
  id: string;
  tenantId: string;
  name: string;
  position: string;
  primaryColor: string;
  secondaryColor: string;
  customLauncherIconUrl?: string;
  customLauncherHtml?: string;
  customCss?: string;
  typingIndicatorStyle?: string;
  typingPhrases?: string[];
  createdAt: string;
  updatedAt: string;
}

export async function handleWidgetPresets(
  method: string,
  _path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  _query: Record<string, string>,
  ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  const tenantId = ctx.organizationId;
  try {
    const id = params['id'];

    // LIST  GET /widget-presets — viewer+
    if (method === 'GET' && !id) {
      if (!requireRole(ctx, 'viewer')) return forbidden('Insufficient role');
      const items = await ddb.queryItems<IWidgetPreset>(
        TABLE, 'tenantId = :t', { ':t': tenantId }, undefined, 'tenantId-index'
      );
      return ok(items);
    }

    // GET /widget-presets/:id — viewer+
    if (method === 'GET' && id) {
      if (!requireRole(ctx, 'viewer')) return forbidden('Insufficient role');
      const item = await ddb.getItem<IWidgetPreset>(TABLE, { id });
      if (!item) return notFound('Preset not found');
      if (item.tenantId !== tenantId) return forbidden();
      return ok(item);
    }

    // POST /widget-presets — editor+
    if (method === 'POST' && !id) {
      if (!requireRole(ctx, 'editor')) return forbidden('Editor role required');
      const b = parseBody<{
        name: string;
        position?: string;
        primaryColor: string;
        secondaryColor?: string;
        customLauncherIconUrl?: string;
        customLauncherHtml?: string;
        customCss?: string;
        typingIndicatorStyle?: string;
        typingPhrases?: string[];
      }>(JSON.stringify(body));
      if (!b?.name) return badRequest('name is required');
      if (!b?.primaryColor) return badRequest('primaryColor is required');

      const now = new Date().toISOString();
      const preset: IWidgetPreset = {
        id: uuidv4(),
        tenantId,
        name: b.name,
        position: b.position || 'bottom-right',
        primaryColor: b.primaryColor,
        secondaryColor: b.secondaryColor || b.primaryColor,
        customLauncherIconUrl: b.customLauncherIconUrl,
        customLauncherHtml: b.customLauncherHtml,
        customCss: b.customCss,
        typingIndicatorStyle: b.typingIndicatorStyle,
        typingPhrases: b.typingPhrases,
        createdAt: now,
        updatedAt: now,
      };
      await ddb.putItem(TABLE, preset as unknown as Record<string, unknown>);
      return created(preset);
    }

    // PUT /widget-presets/:id — editor+
    if (method === 'PUT' && id) {
      if (!requireRole(ctx, 'editor')) return forbidden('Editor role required');
      const item = await ddb.getItem<IWidgetPreset>(TABLE, { id });
      if (!item) return notFound('Preset not found');
      if (item.tenantId !== tenantId) return forbidden();

      const updates: Record<string, unknown> = { ...body, updatedAt: new Date().toISOString() };
      delete updates['id'];
      delete updates['tenantId'];
      delete updates['createdAt'];
      await ddb.updateItem(TABLE, { id }, updates);
      return ok({ ...item, ...updates });
    }

    // DELETE /widget-presets/:id — editor+
    if (method === 'DELETE' && id) {
      if (!requireRole(ctx, 'editor')) return forbidden('Editor role required');
      const item = await ddb.getItem<IWidgetPreset>(TABLE, { id });
      if (!item) return notFound('Preset not found');
      if (item.tenantId !== tenantId) return forbidden();
      await ddb.deleteItem(TABLE, { id });
      return noContent();
    }

    return notFound();
  } catch (e) {
    console.error('widget-presets handler error', e);
    return serverError(String(e));
  }
}
