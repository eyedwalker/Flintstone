import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Subscription, interval } from 'rxjs';
import { takeWhile } from 'rxjs/operators';
import { KnowledgeBaseManager } from '../../../../lib/managers/knowledge-base.manager';
import {
  IKnowledgeBaseDefinition,
  IKnowledgeBaseContent,
  IUploadProgress,
  ContentScope,
  ContentType,
  ROLE_ACCESS_LEVELS,
  RoleLevelValue,
} from '../../../../lib/models/knowledge-base.model';
import {
  ConfirmDialogComponent, IConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';

interface IActiveUpload { name: string; progress: number; status: string; }

@Component({
  selector: 'bcc-kb-detail',
  templateUrl: './kb-detail.component.html',
  styleUrls: ['./kb-detail.component.scss'],
})
export class KbDetailComponent implements OnInit, OnDestroy {
  kbId = '';
  kbDef: IKnowledgeBaseDefinition | null = null;
  content: IKnowledgeBaseContent[] = [];
  loading = true;
  activeUploads: IActiveUpload[] = [];
  editingName = false;
  editName = '';
  editDescription = '';

  // URL form
  urlForm: FormGroup;
  showUrlForm = false;
  urlIngesting = false;
  uploadRoleLevel: RoleLevelValue = 0;
  useBDA = false;
  readonly roleAccessLevels = ROLE_ACCESS_LEVELS;

  // Sorting/filtering
  searchTerm = '';
  sortColumn: 'name' | 'type' | 'status' | 'createdAt' = 'createdAt';
  sortDirection: 'asc' | 'desc' = 'desc';

  readonly typeIcons: Record<string, string> = {
    pdf: 'picture_as_pdf', word: 'description', excel: 'table_chart',
    powerpoint: 'slideshow', text: 'article', csv: 'grid_on',
    url: 'link', website: 'public', youtube: 'smart_display',
    vimeo: 'video_library', image: 'image', custom: 'attach_file',
    file: 'insert_drive_file',
  };

  private subs = new Subscription();
  private pollingActive = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private kbManager: KnowledgeBaseManager,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
  ) {
    this.urlForm = this.fb.group({
      url: ['', [Validators.required, Validators.pattern(/^https?:\/\/.+/)]],
      title: [''],
      scope: ['tenant', Validators.required],
      minRoleLevel: [0],
      crawlDepth: [1],
    });
  }

  async ngOnInit(): Promise<void> {
    this.kbId = this.route.snapshot.paramMap.get('id') ?? '';
    const [defRes, contentRes] = await Promise.all([
      this.kbManager.getDefinition(this.kbId),
      this.kbManager.listContentByKbId(''), // Placeholder — load after we have bedrockKbId
    ]);
    this.kbDef = defRes.data ?? null;
    if (this.kbDef?.bedrockKnowledgeBaseId) {
      const cRes = await this.kbManager.listContentByKbId(this.kbDef.bedrockKnowledgeBaseId);
      this.content = cRes.data ?? [];
    }
    this.loading = false;
    this.startStatusPolling();
  }

  ngOnDestroy(): void { this.subs.unsubscribe(); }

  // ── Name/description editing ────────────────────────────────────────────

  startEdit(): void {
    this.editingName = true;
    this.editName = this.kbDef?.name ?? '';
    this.editDescription = this.kbDef?.description ?? '';
  }

  async saveEdit(): Promise<void> {
    if (!this.editName.trim()) return;
    const result = await this.kbManager.updateDefinition(this.kbId, {
      name: this.editName.trim(),
      description: this.editDescription.trim() || undefined,
    });
    if (result.success && result.data) {
      this.kbDef = { ...this.kbDef!, ...result.data };
      this.snackBar.open('Updated', '', { duration: 2000 });
    }
    this.editingName = false;
  }

  cancelEdit(): void { this.editingName = false; }

  // ── File upload ─────────────────────────────────────────────────────────

  async onFileInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    for (const file of files) { await this.uploadFile(file); }
    input.value = '';
  }

  private async uploadFile(file: File): Promise<void> {
    const bedrockKbId = this.kbDef?.bedrockKnowledgeBaseId;
    if (!bedrockKbId) {
      this.snackBar.open('Provision this knowledge base before uploading', 'OK', { duration: 4000 });
      return;
    }
    const upload: IActiveUpload = { name: file.name, progress: 0, status: 'uploading' };
    this.activeUploads.push(upload);

    // Use a dummy assistantId — the content is associated via knowledgeBaseId
    const { progressSubject, promise } = this.kbManager.ingestFile(
      file, 'kb-shared', '', bedrockKbId, 'tenant', [], this.uploadRoleLevel, this.useBDA,
    );
    const sub = progressSubject.subscribe((p: IUploadProgress) => {
      upload.progress = p.progress;
      upload.status = p.status;
    });
    this.subs.add(sub);

    try {
      await promise;
      this.snackBar.open(`"${file.name}" queued for indexing`, '', { duration: 2500 });
    } catch {
      this.snackBar.open(`Failed to upload "${file.name}"`, 'OK', { duration: 4000 });
    } finally {
      this.activeUploads = this.activeUploads.filter((u) => u !== upload);
      sub.unsubscribe();
      await this.reloadContent();
      this.startStatusPolling();
    }
  }

  // ── URL ingestion ───────────────────────────────────────────────────────

  async ingestUrl(): Promise<void> {
    if (this.urlForm.invalid || this.urlIngesting) return;
    const bedrockKbId = this.kbDef?.bedrockKnowledgeBaseId;
    if (!bedrockKbId) {
      this.snackBar.open('Provision this knowledge base first', 'OK', { duration: 4000 });
      return;
    }
    this.urlIngesting = true;
    const { url, title, scope, minRoleLevel, crawlDepth } = this.urlForm.value;
    try {
      const result = await this.kbManager.ingestUrl(
        { url, title: title || undefined, scope, minRoleLevel: minRoleLevel ?? 0, crawlDepth: crawlDepth ?? 1 },
        'kb-shared', '', bedrockKbId, this.useBDA,
      );
      if (!result.success) throw new Error(result.error);
      this.snackBar.open('URL queued for ingestion', '', { duration: 2500 });
      this.urlForm.reset({ scope: 'tenant', crawlDepth: 1 });
      this.showUrlForm = false;
      await this.reloadContent();
      this.startStatusPolling();
    } catch {
      this.snackBar.open('URL ingestion failed', 'OK', { duration: 4000 });
    }
    this.urlIngesting = false;
  }

  // ── Content management ──────────────────────────────────────────────────

  confirmDelete(item: IKnowledgeBaseContent): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Content',
        message: `Permanently remove "${item.title || item.id}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        destructive: true,
      } as IConfirmDialogData,
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) return;
      const result = await this.kbManager.deleteContent(item);
      if (result.success) {
        this.content = this.content.filter((c) => c.id !== item.id);
        this.snackBar.open('Content removed', '', { duration: 2000 });
      }
    });
  }

  // ── Filtered + sorted ──────────────────────────────────────────────────

  get filteredContent(): IKnowledgeBaseContent[] {
    const term = this.searchTerm.toLowerCase().trim();
    let result = this.content;
    if (term) {
      result = result.filter((c) => {
        const haystack = `${c.title} ${c.sourceUrl ?? ''}`.toLowerCase();
        return haystack.includes(term);
      });
    }
    const dir = this.sortDirection === 'asc' ? 1 : -1;
    return [...result].sort((a, b) => {
      const valA = (a as any)[this.sortColumn] ?? '';
      const valB = (b as any)[this.sortColumn] ?? '';
      return valA < valB ? -dir : valA > valB ? dir : 0;
    });
  }

  // ── Status polling ──────────────────────────────────────────────────────

  private startStatusPolling(): void {
    const hasActive = this.content.some((c) => c.status === 'processing' || c.status === 'uploading');
    if (!hasActive || this.pollingActive) return;
    this.pollingActive = true;
    const pollSub = interval(10000).pipe(
      takeWhile(() => this.content.some((c) => c.status === 'processing' || c.status === 'uploading'), true),
    ).subscribe(async () => {
      await this.reloadContent();
      if (!this.content.some((c) => c.status === 'processing' || c.status === 'uploading')) {
        this.pollingActive = false;
      }
    });
    this.subs.add(pollSub);
  }

  private async reloadContent(): Promise<void> {
    if (!this.kbDef?.bedrockKnowledgeBaseId) return;
    const r = await this.kbManager.listContentByKbId(this.kbDef.bedrockKnowledgeBaseId);
    if (r.data) this.content = r.data;
  }

  // ── Utilities ──────────────────────────────────────────────────────────

  goBack(): void { this.router.navigate(['/knowledge-bases']); }

  getIcon(type: string): string { return this.typeIcons[type] ?? 'attach_file'; }

  getRoleLabel(level: number | undefined): string {
    const entry = ROLE_ACCESS_LEVELS.find((r) => r.value === (level ?? 0));
    return entry?.label ?? 'Everyone';
  }
}
