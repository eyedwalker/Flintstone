import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HierarchyManager } from '../../../../lib/managers/hierarchy.manager';
import { AssistantManager } from '../../../../lib/managers/assistant.manager';
import { AuthService } from '../../../core/services/auth.service';
import { IHierarchyTreeNode, IHierarchyDefinition } from '../../../../lib/models/hierarchy.model';
import { IAssistant } from '../../../../lib/models/tenant.model';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'bcc-hierarchy-manager',
  templateUrl: './hierarchy-manager.component.html',
  styleUrls: ['./hierarchy-manager.component.scss'],
})
export class HierarchyManagerComponent implements OnInit {
  tree: IHierarchyTreeNode[] = [];
  definition: IHierarchyDefinition | null = null;
  assistants: IAssistant[] = [];
  loading = true;
  organizationId = '';
  selectedNode: IHierarchyTreeNode | null = null;
  expandedIds = new Set<string>();

  constructor(
    private hierarchyManager: HierarchyManager,
    private assistantManager: AssistantManager,
    private auth: AuthService,
    private router: Router,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    this.organizationId = this.auth.currentUser?.sub ?? '';
    await Promise.all([this.loadTree(), this.loadAssistants()]);
    this.loading = false;
  }

  private async loadTree(): Promise<void> {
    const defResult = await this.hierarchyManager.getDefinition(this.organizationId);
    this.definition = defResult.data ?? null;
    const treeResult = await this.hierarchyManager.getTree(this.organizationId);
    this.tree = treeResult.data ?? [];
    this.tree.forEach((n) => this.expandedIds.add(n.id));
  }

  private async loadAssistants(): Promise<void> {
    const result = await this.assistantManager.listAssistants(this.organizationId);
    this.assistants = result.data ?? [];
  }

  toggleExpand(node: IHierarchyTreeNode): void {
    this.expandedIds.has(node.id)
      ? this.expandedIds.delete(node.id)
      : this.expandedIds.add(node.id);
  }

  isExpanded(node: IHierarchyTreeNode): boolean {
    return this.expandedIds.has(node.id);
  }

  selectNode(node: IHierarchyTreeNode): void {
    this.selectedNode = node;
  }

  getLevelIcon(node: IHierarchyTreeNode): string {
    return this.definition?.levels.find((l) => l.id === node.levelId)?.icon ?? 'business';
  }

  canHaveChildren(node: IHierarchyTreeNode): boolean {
    const depth = this.definition?.levels.find((l) => l.id === node.levelId)?.depth ?? 0;
    return depth < (this.definition?.levels.length ?? 1) - 1;
  }

  canAssignAssistant(node: IHierarchyTreeNode): boolean {
    return this.definition?.levels.find((l) => l.id === node.levelId)?.allowsAssistants ?? false;
  }

  getAssistantName(id: string | null): string {
    return this.assistants.find((a) => a.id === id)?.name ?? '';
  }

  addChildNode(parentNode: IHierarchyTreeNode): void {
    const parentDepth = this.definition?.levels.find((l) => l.id === parentNode.levelId)?.depth ?? 0;
    const childLevel = this.definition?.levels.find((l) => l.depth === parentDepth + 1);
    if (!childLevel) return;
    this.router.navigate(['/hierarchy/nodes/new'], {
      queryParams: { parentNodeId: parentNode.id, levelId: childLevel.id, depth: parentDepth + 1 },
    });
  }

  editNode(node: IHierarchyTreeNode): void {
    this.router.navigate(['/hierarchy/nodes', node.id]);
  }

  addRootNode(): void {
    const root = this.definition?.levels[0];
    if (!root) return;
    this.router.navigate(['/hierarchy/nodes/new'], {
      queryParams: { levelId: root.id, depth: 0 },
    });
  }

  async assignAssistant(nodeId: string, assistantId: string): Promise<void> {
    const result = await this.hierarchyManager.assignAssistant(nodeId, assistantId || null);
    if (result.success) {
      this.snackBar.open('Assistant assigned', '', { duration: 2000 });
      await this.loadTree();
      this.selectedNode = this.findNode(this.tree, nodeId);
    } else {
      this.snackBar.open('Failed to assign', 'OK', { duration: 3000 });
    }
  }

  async copyApiKey(node: IHierarchyTreeNode): Promise<void> {
    await navigator.clipboard.writeText(node.nodeApiKey);
    this.snackBar.open('Node API key copied', '', { duration: 2000 });
  }

  async regenerateApiKey(node: IHierarchyTreeNode): Promise<void> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Regenerate API Key',
        message: `This will break any embed snippets using "${node.name}". Continue?`,
        confirmLabel: 'Regenerate',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) return;
      await this.hierarchyManager.regenerateNodeApiKey(node.id);
      this.snackBar.open('API key regenerated — update embed snippets', 'OK', { duration: 5000 });
      await this.loadTree();
    });
  }

  async deleteNode(node: IHierarchyTreeNode): Promise<void> {
    if (node.children.length > 0) {
      this.snackBar.open('Delete all child nodes first', 'OK', { duration: 3000 });
      return;
    }
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Delete "${node.name}"`,
        message: 'This permanently deletes the node and its API key.',
        confirmLabel: 'Delete',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) return;
      const result = await this.hierarchyManager.deleteNode(node.id, this.organizationId);
      if (result.success) {
        this.selectedNode = null;
        this.snackBar.open('Node deleted', '', { duration: 2000 });
        await this.loadTree();
      } else {
        this.snackBar.open(result.error ?? 'Delete failed', 'OK', { duration: 3000 });
      }
    });
  }

  /** Expose Object.keys to template */
  objectKeys(obj: object): string[] { return Object.keys(obj); }

  /** Returns level names joined with arrows for the subtitle */
  getLevelPath(): string {
    return this.definition?.levels.map((l) => l.name).join(' → ') ?? '';
  }

  getFirstLevelName(fallback = 'Node'): string {
    return this.definition?.levels[0]?.name ?? fallback;
  }

  getLastLevelName(): string {
    const lvls = this.definition?.levels;
    return lvls ? (lvls[lvls.length - 1]?.name ?? '') : '';
  }

  getChildLevelName(depth: number, fallback = 'child'): string {
    return this.definition?.levels[depth + 1]?.name ?? fallback;
  }

  private findNode(nodes: IHierarchyTreeNode[], id: string): IHierarchyTreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = this.findNode(node.children, id);
      if (found) return found;
    }
    return null;
  }
}
