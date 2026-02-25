/**
 * Flexible tenant hierarchy model.
 *
 * Organizations define their own structure (e.g. Account→Company→Office)
 * then create nodes at each level. Each node gets its own embed snippet
 * and can inherit or override the parent assistant.
 */

/** One level definition in the hierarchy (e.g. "Company", "Office") */
export interface IHierarchyLevel {
  /** GUID */
  id: string;
  /** Human-readable name shown in UI (e.g. "Office", "Division") */
  name: string;
  /** 0 = root, 1 = second, etc. Max 5 levels */
  depth: number;
  /** Whether assistants can be deployed at this level */
  allowsAssistants: boolean;
  /** Optional icon for the UI (Material icon name) */
  icon: string;
}

/**
 * The hierarchy schema for an organization.
 * Defined once during onboarding and immutable after nodes are created.
 */
export interface IHierarchyDefinition {
  /** GUID — same as the organization/tenant root ID */
  organizationId: string;
  /** Ordered levels from top (depth 0) to bottom */
  levels: IHierarchyLevel[];
  /** Whether child nodes inherit the parent's assistant if they have none */
  inheritAssistants: boolean;
  /** Preset template used to initialize — stored for reference */
  templateId?: string;
  createdAt: string;
  updatedAt: string;
}

/** A concrete node in the hierarchy tree */
export interface IHierarchyNode {
  /** GUID */
  id: string;
  /** Root organization GUID */
  organizationId: string;
  /** Which level this node belongs to */
  levelId: string;
  /** Depth (0 = root) */
  depth: number;
  /** Parent node GUID — null for root */
  parentNodeId: string | null;
  /** Display name */
  name: string;
  /** Full path string for display: "Acme / VSP / NYC Office" */
  path: string;
  /** Array of ancestor node IDs (root first) */
  ancestorIds: string[];
  /** Assistant ID assigned to this node (null = inherit from parent) */
  assignedAssistantId: string | null;
  /** Resolved assistant ID after inheritance walk */
  resolvedAssistantId: string | null;
  /** Custom metadata key-value pairs */
  metadata: Record<string, string>;
  /** Whether this node is active */
  active: boolean;
  /** Embed API key for this specific node */
  nodeApiKey: string;
  createdAt: string;
  updatedAt: string;
}

/** Hierarchy preset templates shown during onboarding */
export interface IHierarchyTemplate {
  id: string;
  name: string;
  description: string;
  example: string;
  levels: Array<{ name: string; icon: string; allowsAssistants: boolean }>;
}

/** Tree node for UI rendering (includes children) */
export interface IHierarchyTreeNode extends IHierarchyNode {
  children: IHierarchyTreeNode[];
  levelName: string;
  isExpanded?: boolean;
}

/** Context payload embedded in JWT and widget launch */
export interface ITenantContext {
  organizationId: string;
  nodeId: string;
  nodeName: string;
  nodePath: string;
  nodeLevel: string;
  ancestorIds: string[];
  resolvedAssistantId: string | null;
}

/** Cognito custom attributes for tenant context */
export interface ICognitoTenantClaims {
  'custom:orgId': string;
  'custom:nodeId': string;
  'custom:nodePath': string;
  'custom:nodeLevel': string;
  'custom:role': TenantRole;
}

/** User role within their tenant node */
export type TenantRole = 'owner' | 'admin' | 'member' | 'viewer';

/** User ↔ Node assignment */
export interface INodeUser {
  userId: string;
  nodeId: string;
  organizationId: string;
  role: TenantRole;
  email: string;
  name: string;
  assignedAt: string;
}
