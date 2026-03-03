import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { KnowledgeBaseManager } from '../../../../lib/managers/knowledge-base.manager';
import {
  IKnowledgeBaseDefinition,
  IAssistantKbLink,
} from '../../../../lib/models/knowledge-base.model';

@Component({
  selector: 'bcc-assistant-kb-picker',
  templateUrl: './assistant-kb-picker.component.html',
  styleUrls: ['./assistant-kb-picker.component.scss'],
})
export class AssistantKbPickerComponent implements OnInit {
  assistantId = '';
  allKbs: IKnowledgeBaseDefinition[] = [];
  linkedKbs: IAssistantKbLink[] = [];
  loading = true;
  linking = false;

  constructor(
    private route: ActivatedRoute,
    private kbManager: KnowledgeBaseManager,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    this.assistantId = this.route.parent?.snapshot.paramMap.get('id') ?? '';
    await this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading = true;
    const [allRes, linkedRes] = await Promise.all([
      this.kbManager.listDefinitions(),
      this.kbManager.listAssistantKbs(this.assistantId),
    ]);
    this.allKbs = (allRes.data ?? []).filter(kb => kb.status === 'ready');
    this.linkedKbs = linkedRes.data ?? [];
    this.loading = false;
  }

  get linkedIds(): Set<string> {
    return new Set(this.linkedKbs.map(l => l.knowledgeBaseId));
  }

  get availableKbs(): IKnowledgeBaseDefinition[] {
    return this.allKbs.filter(kb => !this.linkedIds.has(kb.id));
  }

  getLinkedKbDef(link: IAssistantKbLink): IKnowledgeBaseDefinition | undefined {
    return this.allKbs.find(kb => kb.id === link.knowledgeBaseId) ?? link.knowledgeBase as any;
  }

  async link(kb: IKnowledgeBaseDefinition): Promise<void> {
    this.linking = true;
    const result = await this.kbManager.linkKbToAssistant(this.assistantId, kb.id);
    if (result.success) {
      this.snackBar.open(`"${kb.name}" linked`, '', { duration: 2500 });
      await this.loadData();
    } else {
      this.snackBar.open('Failed to link', 'OK', { duration: 3000 });
    }
    this.linking = false;
  }

  async unlink(link: IAssistantKbLink): Promise<void> {
    const result = await this.kbManager.unlinkKbFromAssistant(this.assistantId, link.knowledgeBaseId);
    if (result.success) {
      this.snackBar.open('Unlinked', '', { duration: 2000 });
      await this.loadData();
    } else {
      this.snackBar.open('Failed to unlink', 'OK', { duration: 3000 });
    }
  }
}
