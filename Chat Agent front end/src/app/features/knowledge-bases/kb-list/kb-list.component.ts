import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { KnowledgeBaseManager } from '../../../../lib/managers/knowledge-base.manager';
import { IKnowledgeBaseDefinition } from '../../../../lib/models/knowledge-base.model';
import {
  ConfirmDialogComponent, IConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'bcc-kb-list',
  templateUrl: './kb-list.component.html',
  styleUrls: ['./kb-list.component.scss'],
})
export class KbListComponent implements OnInit {
  knowledgeBases: IKnowledgeBaseDefinition[] = [];
  loading = true;

  // Create form
  showCreateForm = false;
  newKbName = '';
  newKbDescription = '';
  newKbIsDefault = false;
  creating = false;

  constructor(
    private kbManager: KnowledgeBaseManager,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadKbs();
  }

  async loadKbs(): Promise<void> {
    this.loading = true;
    const result = await this.kbManager.listDefinitions();
    this.knowledgeBases = result.data ?? [];
    this.loading = false;
  }

  async create(): Promise<void> {
    if (!this.newKbName.trim() || this.creating) return;
    this.creating = true;
    const result = await this.kbManager.createDefinition({
      name: this.newKbName.trim(),
      description: this.newKbDescription.trim() || undefined,
      isDefault: this.newKbIsDefault,
    });
    if (result.success) {
      this.snackBar.open('Knowledge base created', '', { duration: 2500 });
      this.newKbName = '';
      this.newKbDescription = '';
      this.newKbIsDefault = false;
      this.showCreateForm = false;
      await this.loadKbs();
    } else {
      this.snackBar.open('Failed to create', 'OK', { duration: 4000 });
    }
    this.creating = false;
  }

  async provision(kb: IKnowledgeBaseDefinition): Promise<void> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Provision Knowledge Base',
        message: `This will create Bedrock resources for "${kb.name}". Continue?`,
        confirmLabel: 'Provision',
      } as IConfirmDialogData,
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) return;
      kb.status = 'provisioning';
      const result = await this.kbManager.provisionDefinition(kb.id);
      if (result.success) {
        this.snackBar.open('Knowledge base provisioned', '', { duration: 3000 });
        await this.loadKbs();
      } else {
        this.snackBar.open('Provisioning failed', 'OK', { duration: 4000 });
        await this.loadKbs();
      }
    });
  }

  async setDefault(kb: IKnowledgeBaseDefinition): Promise<void> {
    const result = await this.kbManager.setDefault(kb.id);
    if (result.success) {
      this.snackBar.open(`"${kb.name}" set as default`, '', { duration: 2500 });
      await this.loadKbs();
    } else {
      this.snackBar.open('Failed to set default', 'OK', { duration: 3000 });
    }
  }

  confirmDelete(kb: IKnowledgeBaseDefinition): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Knowledge Base',
        message: `Permanently delete "${kb.name}"? All Bedrock resources will be removed. This cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
      } as IConfirmDialogData,
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) return;
      const result = await this.kbManager.deleteDefinition(kb.id);
      if (result.success) {
        this.snackBar.open('Knowledge base deleted', '', { duration: 2500 });
        await this.loadKbs();
      } else {
        this.snackBar.open(result.error ?? 'Delete failed', 'OK', { duration: 4000 });
      }
    });
  }

  openDetail(kb: IKnowledgeBaseDefinition): void {
    this.router.navigate(['/knowledge-bases', kb.id]);
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'ready': return 'check_circle';
      case 'provisioning': return 'hourglass_top';
      case 'error': return 'error';
      default: return 'edit_note';
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'ready': return '#4caf50';
      case 'provisioning': return '#ff9800';
      case 'error': return '#f44336';
      default: return '#9e9e9e';
    }
  }
}
