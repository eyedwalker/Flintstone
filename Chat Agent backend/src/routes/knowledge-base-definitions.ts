import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import * as bedrockKb from '../services/bedrock-kb';
import * as s3vectors from '../services/s3-vectors';
import { ok, created, noContent, badRequest, forbidden, notFound, serverError } from '../response';
import { IRequestContext, requireRole, parseBody } from '../auth';

const KB_DEFS_TABLE = process.env['KNOWLEDGE_BASES_TABLE'] ?? '';
const ASSISTANT_KB_TABLE = process.env['ASSISTANT_KB_TABLE'] ?? '';
const CONTENT_TABLE = process.env['CONTENT_TABLE'] ?? '';
const KB_ROLE = process.env['BEDROCK_KB_ROLE_ARN'] ?? '';

export interface IKnowledgeBaseDefinition {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  bedrockKnowledgeBaseId?: string;
  vectorBucketName?: string;
  vectorIndexName?: string;
  vimeoAccessToken?: string;
  status: 'draft' | 'provisioning' | 'ready' | 'error';
  contentCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface IAssistantKbLink {
  assistantId: string;
  knowledgeBaseId: string;
  tenantId: string;
  linkedAt: string;
}

export async function handleKnowledgeBaseDefinitions(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  _query: Record<string, string>,
  ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  const tenantId = ctx.organizationId;
  try {
    const id = params['id'];

    // POST /knowledge-bases/:id/provision — admin+
    if (method === 'POST' && path.endsWith('/provision') && id) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const kbDef = await ddb.getItem<IKnowledgeBaseDefinition>(KB_DEFS_TABLE, { id });
      if (!kbDef) return notFound('Knowledge base not found');
      if (kbDef.tenantId !== tenantId) return forbidden();

      await ddb.updateItem(KB_DEFS_TABLE, { id }, {
        status: 'provisioning',
        updatedAt: new Date().toISOString(),
      });

      try {
        // 1. Create S3 Vectors bucket + index
        const vectorBucketName = kbDef.vectorBucketName ?? `kb${id.replace(/-/g, '')}`;
        const vectorIndexName = kbDef.vectorIndexName ?? 'kb-index';
        const vectorStore = await s3vectors.createVectorStore(vectorBucketName, vectorIndexName);

        // 2. Create Bedrock Knowledge Base
        let bedrockKbId = kbDef.bedrockKnowledgeBaseId ?? '';
        if (!bedrockKbId) {
          const kbName = `${id}-kb`;
          const kbResult = await bedrockKb.createKnowledgeBase(
            kbName, KB_ROLE,
            vectorStore.vectorBucketArn, vectorStore.indexArn
          );
          bedrockKbId = kbResult.knowledgeBaseId;
        }

        await ddb.updateItem(KB_DEFS_TABLE, { id }, {
          bedrockKnowledgeBaseId: bedrockKbId,
          vectorBucketName,
          vectorIndexName,
          status: 'ready',
          updatedAt: new Date().toISOString(),
        });

        return ok({
          success: true,
          bedrockKnowledgeBaseId: bedrockKbId,
          vectorBucketName,
          vectorIndexName,
        });
      } catch (e) {
        await ddb.updateItem(KB_DEFS_TABLE, { id }, {
          status: 'error',
          updatedAt: new Date().toISOString(),
        }).catch(() => undefined);
        throw e;
      }
    }

    // POST /knowledge-bases/:id/set-default — admin+
    if (method === 'POST' && path.endsWith('/set-default') && id) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const kbDef = await ddb.getItem<IKnowledgeBaseDefinition>(KB_DEFS_TABLE, { id });
      if (!kbDef) return notFound('Knowledge base not found');
      if (kbDef.tenantId !== tenantId) return forbidden();

      // Clear existing defaults for this tenant
      const allKbs = await ddb.queryItems<IKnowledgeBaseDefinition>(
        KB_DEFS_TABLE, 'tenantId = :t', { ':t': tenantId }, undefined, 'tenantId-index'
      );
      for (const kb of allKbs) {
        if (kb.isDefault) {
          await ddb.updateItem(KB_DEFS_TABLE, { id: kb.id }, {
            isDefault: false,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      // Set this KB as default
      await ddb.updateItem(KB_DEFS_TABLE, { id }, {
        isDefault: true,
        updatedAt: new Date().toISOString(),
      });

      return ok({ ...kbDef, isDefault: true });
    }

    // LIST  GET /knowledge-bases — viewer+
    if (method === 'GET' && !id) {
      if (!requireRole(ctx, 'viewer')) return forbidden('Insufficient role');
      const items = await ddb.queryItems<IKnowledgeBaseDefinition>(
        KB_DEFS_TABLE, 'tenantId = :t', { ':t': tenantId }, undefined, 'tenantId-index'
      );

      // Enrich with linked assistant count
      const enriched = await Promise.all(items.map(async (kb) => {
        const links = await ddb.queryItems<IAssistantKbLink>(
          ASSISTANT_KB_TABLE,
          'knowledgeBaseId = :k', { ':k': kb.id },
          undefined, 'knowledgeBaseId-index'
        );
        // Count content items
        let contentCount = 0;
        if (kb.bedrockKnowledgeBaseId) {
          const content = await ddb.queryItems(
            CONTENT_TABLE,
            'knowledgeBaseId = :k', { ':k': kb.bedrockKnowledgeBaseId },
            undefined, 'knowledgeBaseId-index'
          );
          contentCount = content.length;
        }
        return { ...kb, linkedAssistantCount: links.length, contentCount };
      }));

      return ok(enriched);
    }

    // GET /knowledge-bases/:id — viewer+
    if (method === 'GET' && id) {
      if (!requireRole(ctx, 'viewer')) return forbidden('Insufficient role');
      const kbDef = await ddb.getItem<IKnowledgeBaseDefinition>(KB_DEFS_TABLE, { id });
      if (!kbDef) return notFound('Knowledge base not found');
      if (kbDef.tenantId !== tenantId) return forbidden();

      // Enrich with linked assistants
      const links = await ddb.queryItems<IAssistantKbLink>(
        ASSISTANT_KB_TABLE,
        'knowledgeBaseId = :k', { ':k': id },
        undefined, 'knowledgeBaseId-index'
      );

      return ok({ ...kbDef, linkedAssistantIds: links.map(l => l.assistantId) });
    }

    // POST /knowledge-bases — admin+
    if (method === 'POST' && !id) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const b = parseBody<{ name: string; description?: string; isDefault?: boolean }>(JSON.stringify(body));
      if (!b?.name) return badRequest('name is required');

      // If setting as default, clear existing defaults
      if (b.isDefault) {
        const allKbs = await ddb.queryItems<IKnowledgeBaseDefinition>(
          KB_DEFS_TABLE, 'tenantId = :t', { ':t': tenantId }, undefined, 'tenantId-index'
        );
        for (const kb of allKbs) {
          if (kb.isDefault) {
            await ddb.updateItem(KB_DEFS_TABLE, { id: kb.id }, {
              isDefault: false,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      const now = new Date().toISOString();
      const kbDef: IKnowledgeBaseDefinition = {
        id: uuidv4(),
        tenantId,
        name: b.name,
        description: b.description,
        isDefault: b.isDefault ?? false,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      };
      await ddb.putItem(KB_DEFS_TABLE, kbDef as unknown as Record<string, unknown>);
      return created(kbDef);
    }

    // PUT /knowledge-bases/:id — editor+
    if (method === 'PUT' && id) {
      if (!requireRole(ctx, 'editor')) return forbidden('Editor role required');
      const kbDef = await ddb.getItem<IKnowledgeBaseDefinition>(KB_DEFS_TABLE, { id });
      if (!kbDef) return notFound('Knowledge base not found');
      if (kbDef.tenantId !== tenantId) return forbidden();

      const b = parseBody<{ name?: string; description?: string; vimeoAccessToken?: string }>(JSON.stringify(body));
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (b?.name !== undefined) updates.name = b.name;
      if (b?.description !== undefined) updates.description = b.description;
      if (b?.vimeoAccessToken !== undefined) updates.vimeoAccessToken = b.vimeoAccessToken;

      await ddb.updateItem(KB_DEFS_TABLE, { id }, updates);
      return ok({ ...kbDef, ...updates });
    }

    // DELETE /knowledge-bases/:id — admin+
    if (method === 'DELETE' && id) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const kbDef = await ddb.getItem<IKnowledgeBaseDefinition>(KB_DEFS_TABLE, { id });
      if (!kbDef) return notFound('Knowledge base not found');
      if (kbDef.tenantId !== tenantId) return forbidden();

      // Check if any assistants are linked
      const links = await ddb.queryItems<IAssistantKbLink>(
        ASSISTANT_KB_TABLE,
        'knowledgeBaseId = :k', { ':k': id },
        undefined, 'knowledgeBaseId-index'
      );
      if (links.length > 0) {
        return badRequest(
          `Cannot delete: ${links.length} assistant(s) are still linked to this knowledge base. Unlink them first.`
        );
      }

      // Clean up Bedrock resources if provisioned
      if (kbDef.bedrockKnowledgeBaseId) {
        try { await bedrockKb.deleteKnowledgeBase(kbDef.bedrockKnowledgeBaseId); } catch { /* ok */ }
      }
      if (kbDef.vectorBucketName && kbDef.vectorIndexName) {
        try { await s3vectors.deleteVectorStore(kbDef.vectorBucketName, kbDef.vectorIndexName); } catch { /* ok */ }
      }

      await ddb.deleteItem(KB_DEFS_TABLE, { id });
      return noContent();
    }

    return notFound();
  } catch (e) {
    console.error('knowledge-base-definitions handler error', e);
    return serverError(String(e));
  }
}
