import { Injectable } from '@angular/core';
import {
  IHierarchyDefinition,
  IHierarchyLevel,
  IHierarchyNode,
  IHierarchyTreeNode,
  INodeUser,
  ITenantContext,
  TenantRole,
} from '../models/hierarchy.model';
import { IAccessorResult } from '../models/tenant.model';
import { ApiService } from '../../app/core/services/api.service';
import { HierarchyEngine } from '../engines/hierarchy.engine';

/**
 * Manager for full tenant hierarchy lifecycle.
 * All operations go through the secure API Gateway.
 */
@Injectable({ providedIn: 'root' })
export class HierarchyManager {
  constructor(
    private api: ApiService,
    private hierarchyEngine: HierarchyEngine,
  ) {}

  async saveDefinition(
    organizationId: string,
    levels: IHierarchyLevel[],
    inheritAssistants: boolean,
    templateId?: string,
  ): Promise<IAccessorResult<IHierarchyDefinition>> {
    const errors = this.hierarchyEngine.validateDefinition(levels);
    if (errors.length > 0) return { success: false, error: errors.join('; ') };
    return this.api.put<IHierarchyDefinition>('/hierarchy/definition', {
      levels, inheritAssistants, templateId,
    });
  }

  async getDefinition(_organizationId: string): Promise<IAccessorResult<IHierarchyDefinition | null>> {
    return this.api.get<IHierarchyDefinition | null>('/hierarchy/definition');
  }

  async createNode(
    _organizationId: string,
    levelId: string,
    depth: number,
    name: string,
    parentNodeId: string | null,
    metadata: Record<string, string> = {}
  ): Promise<IAccessorResult<IHierarchyNode>> {
    return this.api.post<IHierarchyNode>('/hierarchy/nodes', {
      levelId, depth, name, parentNodeId, metadata,
    });
  }

  async getNode(id: string): Promise<IAccessorResult<IHierarchyNode | null>> {
    return this.api.get<IHierarchyNode | null>(`/hierarchy/nodes/${id}`);
  }

  async listNodes(_organizationId: string): Promise<IAccessorResult<IHierarchyNode[]>> {
    // Tree endpoint returns the same data in structured form
    const res = await this.api.get<IHierarchyTreeNode[]>('/hierarchy/tree');
    if (!res.success) return { success: false, error: res.error };
    return { success: true, data: this.flattenTree(res.data ?? []) as unknown as IHierarchyNode[] };
  }

  async getTree(_organizationId: string): Promise<IAccessorResult<IHierarchyTreeNode[]>> {
    return this.api.get<IHierarchyTreeNode[]>('/hierarchy/tree');
  }

  async updateNode(
    id: string,
    updates: Partial<Pick<IHierarchyNode, 'name' | 'metadata' | 'active'>>
  ): Promise<IAccessorResult<void>> {
    return this.api.put<void>(`/hierarchy/nodes/${id}`, updates);
  }

  async assignAssistant(nodeId: string, assistantId: string | null): Promise<IAccessorResult<void>> {
    return this.api.post<void>(`/hierarchy/nodes/${nodeId}/assign`, { assistantId });
  }

  async deleteNode(id: string, _organizationId: string): Promise<IAccessorResult<void>> {
    return this.api.delete<void>(`/hierarchy/nodes/${id}`);
  }

  async regenerateNodeApiKey(id: string): Promise<IAccessorResult<string>> {
    const res = await this.api.post<{ nodeApiKey: string }>(`/hierarchy/nodes/${id}/regen-key`);
    if (!res.success || !res.data) return { success: false, error: res.error };
    return { success: true, data: res.data.nodeApiKey };
  }

  async assignUser(
    userId: string,
    nodeId: string,
    organizationId: string,
    role: TenantRole,
    email: string,
    name: string
  ): Promise<IAccessorResult<void>> {
    return this.api.post<void>('/hierarchy/users', { userId, nodeId, organizationId, role, email, name });
  }

  async getUserNode(userId: string): Promise<IAccessorResult<INodeUser | null>> {
    return this.api.get<INodeUser | null>(`/hierarchy/users/${userId}`);
  }

  async resolveTenantContext(userId: string): Promise<IAccessorResult<ITenantContext>> {
    const assignmentRes = await this.getUserNode(userId);
    if (!assignmentRes.success || !assignmentRes.data) {
      return { success: false, error: 'User has no tenant node assignment' };
    }
    const treeRes = await this.getTree(assignmentRes.data.organizationId);
    const defRes = await this.getDefinition(assignmentRes.data.organizationId);
    if (!treeRes.data || !defRes.data) {
      return { success: false, error: 'Could not resolve tenant context' };
    }
    const nodes = this.flattenTree(treeRes.data) as unknown as IHierarchyNode[];
    const node = nodes.find((n) => n.id === assignmentRes.data!.nodeId);
    if (!node) return { success: false, error: 'Node not found' };
    const context = this.hierarchyEngine.buildTenantContext(node, nodes, defRes.data);
    return { success: true, data: context };
  }

  private flattenTree(nodes: IHierarchyTreeNode[]): IHierarchyTreeNode[] {
    const result: IHierarchyTreeNode[] = [];
    const walk = (arr: IHierarchyTreeNode[]) => arr.forEach((n) => { result.push(n); walk(n.children); });
    walk(nodes);
    return result;
  }
}
