import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { HierarchyManager } from '../../../lib/managers/hierarchy.manager';
import { EscalationManager } from '../../../lib/managers/escalation.manager';
import { EmbedCodeEngine, IEmbedCodeOptions } from '../../../lib/engines/embed-code.engine';
import { IEscalationConfig } from '../../../lib/models/escalation.model';
import { AuthService } from '../../core/services/auth.service';
import { IAssistant } from '../../../lib/models/tenant.model';
import { IHierarchyTreeNode } from '../../../lib/models/hierarchy.model';
import { environment } from '../../../environments/environment';

/** Embed Code — generate HTML snippets and live-test the assistant */
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
  escalationConfig: IEscalationConfig | null = null;
  htmlSnippet = '';
  consoleSnippet = '';
  selfHostedSnippet = '';
  inlineSnippet = '';
  widgetDownloadUrl = '';
  private widgetSource = '';

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private assistantManager: AssistantManager,
    private hierarchyManager: HierarchyManager,
    private escalationManager: EscalationManager,
    private embedEngine: EmbedCodeEngine,
    private auth: AuthService,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    this.assistantId = this.route.snapshot.paramMap.get('id') ?? '';
    this.tenantId = this.auth.currentUser?.sub ?? '';
    const [aRes, tRes, escRes] = await Promise.all([
      this.assistantManager.getAssistant(this.assistantId),
      this.hierarchyManager.getTree(this.tenantId),
      this.escalationManager.getConfig(this.assistantId),
    ]);
    this.assistant = aRes.data ?? null;
    this.nodes = this.flattenTree(tRes.data ?? []);
    this.escalationConfig = escRes.data ?? null;

    // Load widget JS source for inline console snippet
    try {
      this.widgetSource = await firstValueFrom(
        this.http.get('assets/aws-agent-chat.min.js', { responseType: 'text' }),
      );
    } catch {
      this.widgetSource = '';
    }

    this.generateSnippets();
    this.loading = false;
  }

  onNodeChange(): void {
    this.generateSnippets();
  }

  get canChat(): boolean {
    return this.assistant?.status === 'ready' &&
      !!this.assistant?.bedrockAgentId;
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
      escalation: this.escalationConfig?.enabled
        ? {
            enabled: true,
            mode: this.escalationConfig.triggerMode,
            buttonLabel: 'Support',
          }
        : undefined,
    };

    this.htmlSnippet = this.embedEngine.generateHtmlSnippet(this.assistant, options);
    this.consoleSnippet = this.embedEngine.generateConsoleSnippet(this.assistant, options);
    this.selfHostedSnippet = this.embedEngine.generateSelfHostedSnippet(this.assistant, options);
    this.inlineSnippet = this.widgetSource
      ? this.embedEngine.generateInlineSnippet(this.assistant, options, this.widgetSource)
      : '';
    this.widgetDownloadUrl = this.embedEngine.getWidgetDownloadUrl(options);
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
