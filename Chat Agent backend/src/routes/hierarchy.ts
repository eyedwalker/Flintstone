import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import { ok, created, noContent, badRequest, forbidden, notFound, serverError } from '../response';
import { assertOwnership, parseBody } from '../auth';

const DEF_TABLE = process.env['HIERARCHY_DEFINITIONS_TABLE'] ?? '';
const NODES_TABLE = process.env['HIERARCHY_NODES_TABLE'] ?? '';
const NODE_USERS_TABLE = process.env['NODE_USERS_TABLE'] ?? '';

interface IHierarchyNode {
  id: string;
  organizationId: string;
  levelId: string;
  depth: number;
  name: string;
  path: string;
  parentNodeId?: string;
  ancestorIds: string[];
  assignedAssistantId?: string;
  resolvedAssistantId?: string;
  nodeApiKey: string;
  metadata: Record<string, string>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  levelName?: string;
  children: IHierarchyNode[];
}

export async function handleHierarchy(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  _query: Record<string, string>,
  tenantId: string
): Promise<APIGatewayProxyResultV2> {
  try {
    // ── Definition routes ─────────────────────────────────────────
    if (path.includes('/definition')) {
      if (method === 'GET') {
        const def = await ddb.getItem(DEF_TABLE, { organizationId: tenantId });
        return ok(def);
      }
      if (method === 'PUT') {
        const def = { ...body, organizationId: tenantId, updatedAt: new Date().toISOString() };
        await ddb.putItem(DEF_TABLE, def);
        return ok(def);
      }
    }

    // ── Tree route ────────────────────────────────────────────────
    if (path.endsWith('/tree')) {
      const [nodes, definition] = await Promise.all([
        ddb.queryItems<IHierarchyNode>(
          NODES_TABLE,
          '#org = :org',
          { ':org': tenantId },
          { '#org': 'organizationId' },
          'organizationId-index'
        ),
        ddb.getItem<{ levels: Array<{ id: string; name: string; depth: number }> }>(
          DEF_TABLE, { organizationId: tenantId }
        ),
      ]);
      const tree = buildTree(nodes, definition?.levels ?? []);
      return ok(tree);
    }

    const id = params['id'];

    // POST /hierarchy/nodes
    if (method === 'POST' && path.endsWith('/nodes')) {
      const b = parseBody<{
        name: string; levelId: string; depth: number;
        parentNodeId?: string; metadata?: Record<string, string>;
      }>(JSON.stringify(body));
      if (!b?.name || !b?.levelId) return badRequest('name and levelId are required');

      const parentPath = b.parentNodeId
        ? (await ddb.getItem<IHierarchyNode>(NODES_TABLE, { id: b.parentNodeId }))?.path ?? ''
        : '';
      const def = await ddb.getItem<{ levels: Array<{ id: string; name: string; depth: number }> }>(
        DEF_TABLE, { organizationId: tenantId }
      );
      const levelName = def?.levels.find((l) => l.id === b.levelId)?.name ?? '';
      const now = new Date().toISOString();
      const node: Omit<IHierarchyNode, 'children'> = {
        id: uuidv4(),
        organizationId: tenantId,
        levelId: b.levelId,
        depth: b.depth,
        name: b.name,
        path: parentPath ? `${parentPath} / ${b.name}` : b.name,
        parentNodeId: b.parentNodeId,
        ancestorIds: b.parentNodeId ? [b.parentNodeId] : [],
        nodeApiKey: `nk_${uuidv4().replace(/-/g, '')}`,
        metadata: b.metadata ?? {},
        active: true,
        levelName,
        createdAt: now,
        updatedAt: now,
      };
      await ddb.putItem(NODES_TABLE, node as unknown as Record<string, unknown>);
      return created({ ...node, children: [] });
    }

    // GET /hierarchy/nodes/:id
    if (method === 'GET' && id) {
      const node = await ddb.getItem<IHierarchyNode>(NODES_TABLE, { id });
      if (!node) return notFound();
      if (!assertOwnership(node.organizationId, tenantId)) return forbidden();
      return ok({ ...node, children: [] });
    }

    // PUT /hierarchy/nodes/:id
    if (method === 'PUT' && id && !path.includes('/assign') && !path.includes('/regen')) {
      const node = await ddb.getItem<IHierarchyNode>(NODES_TABLE, { id });
      if (!node) return notFound();
      if (!assertOwnership(node.organizationId, tenantId)) return forbidden();
      const updates: Record<string, unknown> = { ...body, updatedAt: new Date().toISOString() };
      delete updates['id'];
      delete updates['organizationId'];
      await ddb.updateItem(NODES_TABLE, { id }, updates);
      return ok({ ...node, ...updates });
    }

    // POST /hierarchy/nodes/:id/assign
    if (method === 'POST' && path.endsWith('/assign')) {
      const node = await ddb.getItem<IHierarchyNode>(NODES_TABLE, { id: id! });
      if (!node) return notFound();
      if (!assertOwnership(node.organizationId, tenantId)) return forbidden();
      const { assistantId } = body as { assistantId: string | null };
      await ddb.updateItem(NODES_TABLE, { id: id! }, {
        assignedAssistantId: assistantId ?? null,
        updatedAt: new Date().toISOString(),
      });
      return ok({ success: true });
    }

    // POST /hierarchy/nodes/:id/regen-key
    if (method === 'POST' && path.endsWith('/regen-key')) {
      const node = await ddb.getItem<IHierarchyNode>(NODES_TABLE, { id: id! });
      if (!node) return notFound();
      if (!assertOwnership(node.organizationId, tenantId)) return forbidden();
      const nodeApiKey = `nk_${uuidv4().replace(/-/g, '')}`;
      await ddb.updateItem(NODES_TABLE, { id: id! }, { nodeApiKey, updatedAt: new Date().toISOString() });
      return ok({ nodeApiKey });
    }

    // DELETE /hierarchy/nodes/:id
    if (method === 'DELETE' && id) {
      const node = await ddb.getItem<IHierarchyNode>(NODES_TABLE, { id });
      if (!node) return notFound();
      if (!assertOwnership(node.organizationId, tenantId)) return forbidden();
      const children = await ddb.queryItems(
        NODES_TABLE, '#p = :p', { ':p': id }, { '#p': 'parentNodeId' }, 'organizationId-index'
      );
      if (children.length > 0) return badRequest('Delete child nodes first');
      await ddb.deleteItem(NODES_TABLE, { id });
      return noContent();
    }

    // GET /hierarchy/users/:userId
    if (path.includes('/users/') && method === 'GET') {
      const userId = path.split('/').pop() ?? '';
      const record = await ddb.getItem(NODE_USERS_TABLE, { userId });
      return ok(record);
    }

    return notFound();
  } catch (e) {
    console.error('hierarchy handler error', e);
    return serverError(String(e));
  }
}

function buildTree(
  nodes: IHierarchyNode[],
  levels: Array<{ id: string; name: string; depth: number }>
): IHierarchyNode[] {
  const map = new Map<string, IHierarchyNode>();
  nodes.forEach((n) => {
    const levelName = levels.find((l) => l.id === n.levelId)?.name ?? '';
    map.set(n.id, { ...n, levelName, children: [] });
  });
  const roots: IHierarchyNode[] = [];
  map.forEach((node) => {
    if (node.parentNodeId && map.has(node.parentNodeId)) {
      map.get(node.parentNodeId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}
