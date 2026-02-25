import { Injectable } from '@angular/core';
import {
  IHierarchyDefinition,
  IHierarchyLevel,
  IHierarchyNode,
  IHierarchyTemplate,
  IHierarchyTreeNode,
  ITenantContext,
} from '../models/hierarchy.model';

/**
 * Engine for hierarchy tree operations — all stateless pure logic.
 * Handles building trees, resolving assistant inheritance, and generating templates.
 */
@Injectable({ providedIn: 'root' })
export class HierarchyEngine {

  /** Built-in hierarchy templates shown during onboarding */
  getTemplates(): IHierarchyTemplate[] {
    return [
      {
        id: 'company-only',
        name: 'Company',
        description: 'Single-level — one company, no sub-divisions',
        example: 'Acme Corp',
        levels: [{ name: 'Company', icon: 'business', allowsAssistants: true }],
      },
      {
        id: 'company-office',
        name: 'Company → Office',
        description: 'Two-level — company with multiple office locations',
        example: 'Acme Corp → NYC Office',
        levels: [
          { name: 'Company', icon: 'business', allowsAssistants: false },
          { name: 'Office', icon: 'location_on', allowsAssistants: true },
        ],
      },
      {
        id: 'account-company-office',
        name: 'Account → Company → Office',
        description: 'Three-level — parent account with multiple companies and offices',
        example: 'Acme Account → VSP Corp → NYC Office',
        levels: [
          { name: 'Account', icon: 'account_tree', allowsAssistants: false },
          { name: 'Company', icon: 'business', allowsAssistants: false },
          { name: 'Office', icon: 'location_on', allowsAssistants: true },
        ],
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        description: 'Four-level — enterprise with divisions, departments, and teams',
        example: 'Corp → Division → Department → Team',
        levels: [
          { name: 'Corporation', icon: 'corporate_fare', allowsAssistants: false },
          { name: 'Division', icon: 'account_tree', allowsAssistants: false },
          { name: 'Department', icon: 'groups', allowsAssistants: false },
          { name: 'Team', icon: 'group', allowsAssistants: true },
        ],
      },
      {
        id: 'custom',
        name: 'Custom',
        description: 'Define your own hierarchy from scratch',
        example: 'Your structure...',
        levels: [],
      },
    ];
  }

  /** Build a flat list of IHierarchyLevel from a template */
  buildLevelsFromTemplate(
    template: IHierarchyTemplate,
    orgId: string
  ): IHierarchyLevel[] {
    return template.levels.map((tl, i) => ({
      id: `${orgId}-level-${i}`,
      name: tl.name,
      depth: i,
      allowsAssistants: tl.allowsAssistants,
      icon: tl.icon,
    }));
  }

  /** Convert flat node list into a tree for rendering */
  buildTree(nodes: IHierarchyNode[], definition: IHierarchyDefinition): IHierarchyTreeNode[] {
    const levelMap = new Map(definition.levels.map((l) => [l.id, l.name]));
    const nodeMap = new Map<string, IHierarchyTreeNode>(
      nodes.map((n) => ({
        ...n,
        children: [],
        levelName: levelMap.get(n.levelId) ?? 'Unknown',
      })).map((n) => [n.id, n])
    );

    const roots: IHierarchyTreeNode[] = [];

    for (const node of nodeMap.values()) {
      if (!node.parentNodeId) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(node.parentNodeId);
        parent?.children.push(node);
      }
    }

    return roots;
  }

  /**
   * Walk up the tree to resolve which assistant a node should use.
   * Returns the first assistantId found at node or any ancestor.
   */
  resolveAssistantId(
    nodeId: string,
    nodes: IHierarchyNode[],
    definition: IHierarchyDefinition
  ): string | null {
    if (!definition.inheritAssistants) {
      return nodes.find((n) => n.id === nodeId)?.assignedAssistantId ?? null;
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    let current = nodeMap.get(nodeId);

    while (current) {
      if (current.assignedAssistantId) return current.assignedAssistantId;
      current = current.parentNodeId ? nodeMap.get(current.parentNodeId) : undefined;
    }

    return null;
  }

  /** Build the full path string for a node: "Acme / VSP / NYC Office" */
  buildNodePath(nodeId: string, nodes: IHierarchyNode[]): string {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const parts: string[] = [];
    let current = nodeMap.get(nodeId);

    while (current) {
      parts.unshift(current.name);
      current = current.parentNodeId ? nodeMap.get(current.parentNodeId) : undefined;
    }

    return parts.join(' / ');
  }

  /** Build the ancestor ID array for a node (root first) */
  buildAncestorIds(nodeId: string, nodes: IHierarchyNode[]): string[] {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const ancestors: string[] = [];
    let current = nodeMap.get(nodeId);

    while (current?.parentNodeId) {
      ancestors.unshift(current.parentNodeId);
      current = nodeMap.get(current.parentNodeId);
    }

    return ancestors;
  }

  /** Build the ITenantContext payload for JWT and widget launch */
  buildTenantContext(
    node: IHierarchyNode,
    nodes: IHierarchyNode[],
    definition: IHierarchyDefinition
  ): ITenantContext {
    const level = definition.levels.find((l) => l.id === node.levelId);
    return {
      organizationId: node.organizationId,
      nodeId: node.id,
      nodeName: node.name,
      nodePath: this.buildNodePath(node.id, nodes),
      nodeLevel: level?.name ?? 'unknown',
      ancestorIds: this.buildAncestorIds(node.id, nodes),
      resolvedAssistantId: this.resolveAssistantId(node.id, nodes, definition),
    };
  }

  /** Validate a hierarchy definition before saving */
  validateDefinition(levels: IHierarchyLevel[]): string[] {
    const errors: string[] = [];
    if (levels.length === 0) errors.push('At least one level is required');
    if (levels.length > 5) errors.push('Maximum 5 hierarchy levels allowed');

    levels.forEach((level, i) => {
      if (!level.name.trim()) errors.push(`Level ${i + 1}: name is required`);
    });

    const leafLevel = levels[levels.length - 1];
    if (leafLevel && !leafLevel.allowsAssistants) {
      errors.push('The deepest level must allow assistants');
    }

    return errors;
  }

  /** Get nodes that are eligible to receive an assistant assignment */
  getAssignableNodes(
    nodes: IHierarchyNode[],
    definition: IHierarchyDefinition
  ): IHierarchyNode[] {
    const assignableLevelIds = new Set(
      definition.levels.filter((l) => l.allowsAssistants).map((l) => l.id)
    );
    return nodes.filter((n) => assignableLevelIds.has(n.levelId));
  }

  /** Count total nodes at each level */
  getNodeCountsByLevel(
    nodes: IHierarchyNode[],
    definition: IHierarchyDefinition
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    definition.levels.forEach((l) => { counts[l.name] = 0; });
    nodes.forEach((n) => {
      const level = definition.levels.find((l) => l.id === n.levelId);
      if (level) counts[level.name] = (counts[level.name] ?? 0) + 1;
    });
    return counts;
  }
}
