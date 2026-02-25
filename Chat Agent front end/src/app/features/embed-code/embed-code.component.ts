import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { HierarchyManager } from '../../../lib/managers/hierarchy.manager';
import { EmbedCodeEngine, IEmbedCodeOptions } from '../../../lib/engines/embed-code.engine';
import { AuthService } from '../../core/services/auth.service';
import { IAssistant } from '../../../lib/models/tenant.model';
import { IHierarchyTreeNode } from '../../../lib/models/hierarchy.model';
import { environment } from '../../../environments/environment';

/** Embed Code — generate HTML snippets scoped to assistant or hierarchy node */
@Component({
  selector: 'bcc-embed-code',
  templateUrl: './embed-code.component.html',
  styleUrls: ['./embed-code.component.scss'],
})
export class EmbedCodeComponent implements OnInit {
  assistantId = '';
  tenantId = '';
  assistant: IAssistant | null = null;
  nodes: IHierarchyTreeNode[] = [];
  selectedNodeId = '';
  loading = true;
  htmlSnippet = '';
  consoleSnippet = '';
  activeTab: 'html' | 'console' = 'html';

  constructor(
    private route: ActivatedRoute,
    private assistantManager: AssistantManager,
    private hierarchyManager: HierarchyManager,
    private embedEngine: EmbedCodeEngine,
    private auth: AuthService,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    this.assistantId = this.route.snapshot.paramMap.get('id') ?? '';
    this.tenantId = this.auth.currentUser?.sub ?? '';
    const [aRes, tRes] = await Promise.all([
      this.assistantManager.getAssistant(this.assistantId),
      this.hierarchyManager.getTree(this.tenantId),
    ]);
    this.assistant = aRes.data ?? null;
    this.nodes = this.flattenTree(tRes.data ?? []);
    this.generateSnippets();
    this.loading = false;
  }

  onNodeChange(): void {
    this.generateSnippets();
  }

  private generateSnippets(): void {
    if (!this.assistant) return;

    const selectedNode = this.nodes.find((n) => n.id === this.selectedNodeId);
    const options: IEmbedCodeOptions = {
      widgetCdnUrl: environment.widgetCdnUrl,
      apiEndpoint: environment.chatApiBaseUrl,
      apiKey: this.assistant.apiKey,
      nodeContext: selectedNode
        ? {
            node: selectedNode,
            tenantContext: {
              organizationId: selectedNode.organizationId,
              nodeId: selectedNode.id,
              nodeName: selectedNode.name,
              nodePath: selectedNode.path,
              nodeLevel: selectedNode.levelName,
              ancestorIds: selectedNode.ancestorIds,
              resolvedAssistantId: selectedNode.resolvedAssistantId,
            },
          }
        : undefined,
    };

    this.htmlSnippet = this.embedEngine.generateHtmlSnippet(this.assistant, options);
    this.consoleSnippet = this.embedEngine.generateConsoleSnippet(this.assistant, options);
  }

  get activeSnippet(): string {
    return this.activeTab === 'html' ? this.htmlSnippet : this.consoleSnippet;
  }

  async copySnippet(): Promise<void> {
    await navigator.clipboard.writeText(this.activeSnippet);
    this.snackBar.open('Snippet copied to clipboard', '', { duration: 2000 });
  }

  downloadSnippet(): void {
    const ext = this.activeTab === 'html' ? 'html' : 'js';
    const blob = new Blob([this.activeSnippet], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assistant-embed.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async copyApiKey(): Promise<void> {
    const key = this.selectedNodeId
      ? this.nodes.find((n) => n.id === this.selectedNodeId)?.nodeApiKey
      : this.assistant?.apiKey;
    if (!key) return;
    await navigator.clipboard.writeText(key);
    this.snackBar.open('API key copied', '', { duration: 2000 });
  }

  get activeApiKey(): string {
    if (this.selectedNodeId) {
      return this.nodes.find((n) => n.id === this.selectedNodeId)?.nodeApiKey ?? '';
    }
    return this.assistant?.apiKey ?? '';
  }

  private flattenTree(nodes: IHierarchyTreeNode[]): IHierarchyTreeNode[] {
    const result: IHierarchyTreeNode[] = [];
    const recurse = (arr: IHierarchyTreeNode[]) => {
      arr.forEach((n) => { result.push(n); recurse(n.children); });
    };
    recurse(nodes);
    return result;
  }
}
