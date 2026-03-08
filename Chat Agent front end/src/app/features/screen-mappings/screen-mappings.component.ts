import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ScreenMappingManager } from '../../../lib/managers/screen-mapping.manager';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { IScreenMapping } from '../../../lib/models/screen-mapping.model';
import { IAssistant } from '../../../lib/models/tenant.model';
import { ScreenDetailDialogComponent } from './screen-detail-dialog.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

interface ISectionGroup {
  section: string;
  mappings: IScreenMapping[];
  expanded: boolean;
}

@Component({
  selector: 'bcc-screen-mappings',
  templateUrl: './screen-mappings.component.html',
  styleUrls: ['./screen-mappings.component.scss'],
})
export class ScreenMappingsComponent implements OnInit {
  assistants: IAssistant[] = [];
  selectedAssistantId = '';
  mappings: IScreenMapping[] = [];
  sections: ISectionGroup[] = [];
  loading = false;
  generating = false;
  searchTerm = '';

  // Status counts
  get aiCount(): number { return this.mappings.filter((m) => m.status === 'ai-generated').length; }
  get reviewedCount(): number { return this.mappings.filter((m) => m.status === 'reviewed').length; }
  get customCount(): number { return this.mappings.filter((m) => m.status === 'custom').length; }

  constructor(
    private screenMappingManager: ScreenMappingManager,
    private assistantManager: AssistantManager,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    const res = await this.assistantManager.listAssistants();
    this.assistants = (res.data ?? []).filter((a) => a.status === 'ready');
    if (this.assistants.length) {
      this.selectedAssistantId = this.assistants[0].id;
      await this.loadMappings();
    }
  }

  async onAssistantChange(): Promise<void> {
    await this.loadMappings();
  }

  async loadMappings(): Promise<void> {
    if (!this.selectedAssistantId) return;
    this.loading = true;
    const res = await this.screenMappingManager.listMappings(this.selectedAssistantId);
    this.mappings = res.data ?? [];
    this.buildSections();
    this.loading = false;
  }

  buildSections(): void {
    const filtered = this.searchTerm
      ? this.mappings.filter((m) =>
          m.screenName.toLowerCase().includes(this.searchTerm.toLowerCase())
          || m.section.toLowerCase().includes(this.searchTerm.toLowerCase())
          || m.urlPattern.toLowerCase().includes(this.searchTerm.toLowerCase())
        )
      : this.mappings;

    const map = new Map<string, IScreenMapping[]>();
    for (const m of filtered) {
      const key = m.section || 'Uncategorized';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }

    this.sections = Array.from(map.entries()).map(([section, mappings]) => ({
      section,
      mappings: mappings.sort((a, b) => a.screenName.localeCompare(b.screenName)),
      expanded: true,
    }));
  }

  onSearch(): void {
    this.buildSections();
  }

  async generate(): Promise<void> {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Generate Screen Mappings',
        message: 'This will use AI to map all screens to relevant videos and generate trending questions. Existing AI-generated mappings will be replaced. Reviewed and custom mappings will be preserved.',
        confirmText: 'Generate',
        confirmColor: 'primary',
      },
    });

    const confirmed = await ref.afterClosed().toPromise();
    if (!confirmed) return;

    this.generating = true;
    const res = await this.screenMappingManager.generateMappings(this.selectedAssistantId);
    this.generating = false;

    if (res.success) {
      this.snackBar.open(`Generated mappings for ${res.data?.count ?? 0} screens`, '', { duration: 3000 });
      await this.loadMappings();
    } else {
      this.snackBar.open(`Generation failed: ${res.error}`, 'Dismiss', { duration: 5000 });
    }
  }

  openDetail(mapping: IScreenMapping): void {
    const ref = this.dialog.open(ScreenDetailDialogComponent, {
      width: '800px',
      maxHeight: '90vh',
      data: { mapping: { ...mapping, videos: [...mapping.videos], trendingQuestions: [...mapping.trendingQuestions] } },
    });

    ref.afterClosed().subscribe((updated) => {
      if (updated) {
        const idx = this.mappings.findIndex((m) => m.id === updated.id);
        if (idx >= 0) this.mappings[idx] = updated;
        this.buildSections();
      }
    });
  }

  async deleteMapping(mapping: IScreenMapping, event: Event): Promise<void> {
    event.stopPropagation();
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Mapping',
        message: `Remove screen mapping for "${mapping.screenName}"?`,
        confirmText: 'Delete',
        confirmColor: 'warn',
      },
    });

    const confirmed = await ref.afterClosed().toPromise();
    if (!confirmed) return;

    const res = await this.screenMappingManager.deleteMapping(mapping.id);
    if (res.success) {
      this.mappings = this.mappings.filter((m) => m.id !== mapping.id);
      this.buildSections();
      this.snackBar.open('Mapping deleted', '', { duration: 2000 });
    }
  }

  statusColor(status: string): string {
    switch (status) {
      case 'ai-generated': return 'accent';
      case 'reviewed': return 'primary';
      case 'custom': return '';
      default: return '';
    }
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'ai-generated': return 'AI Generated';
      case 'reviewed': return 'Reviewed';
      case 'custom': return 'Custom';
      default: return status;
    }
  }
}
