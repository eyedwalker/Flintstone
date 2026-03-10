import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Subscription, interval } from 'rxjs';
import { takeWhile } from 'rxjs/operators';
import { KnowledgeBaseManager } from '../../../../lib/managers/knowledge-base.manager';
import { AuthService } from '../../../core/services/auth.service';
import {
  IKnowledgeBaseDefinition,
  IKnowledgeBaseContent,
  IUploadProgress,
  IContentPreview,
  ContentScope,
  ContentType,
  ROLE_ACCESS_LEVELS,
  RoleLevelValue,
} from '../../../../lib/models/knowledge-base.model';
import {
  ConfirmDialogComponent, IConfirmDialogData,
} from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import {
  EditContentDialogComponent, IEditContentResult,
} from '../../../shared/components/edit-content-dialog/edit-content-dialog.component';
import {
  VimeoBrowserDialogComponent,
} from '../../../shared/components/vimeo-browser-dialog/vimeo-browser-dialog.component';

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

  // Vimeo
  vimeoToken = '';
  savingVimeoToken = false;

  // URL form
  urlForm: FormGroup;
  showUrlForm = false;
  urlIngesting = false;
  uploadRoleLevel: RoleLevelValue = 0;
  useBDA = false;
  readonly roleAccessLevels = ROLE_ACCESS_LEVELS;
  readonly crawlDepthOptions = [
    { value: 1, label: 'This page only' },
    { value: 2, label: '+linked pages' },
    { value: 3, label: 'Deep (slow)' },
    { value: 4, label: 'Very deep' },
    { value: 5, label: 'Full crawl' },
  ];

  // Batch URL import
  showBatchUrlForm = false;
  batchUrlText = '';
  batchUrlIngesting = false;
  batchUrlProgress = 0;
  batchUrlTotal = 0;

  // Sorting/filtering
  searchTerm = '';
  scopeFilter: ContentScope | '' = '';
  typeFilter: ContentType | '' = '';
  sortColumn: 'title' | 'type' | 'status' | 'createdAt' = 'createdAt';
  sortDirection: 'asc' | 'desc' = 'desc';

  // Bulk selection
  selectedIds = new Set<string>();

  // Expansion + preview
  expandedItemId: string | null = null;
  previewItemId = '';
  previewLoading = false;
  previewData: IContentPreview | null = null;

  readonly typeIcons: Record<string, string> = {
    pdf: 'picture_as_pdf', word: 'description', excel: 'table_chart',
    powerpoint: 'slideshow', text: 'article', csv: 'grid_on',
    url: 'link', website: 'public', youtube: 'smart_display',
    vimeo: 'video_library', image: 'image', custom: 'attach_file',
    file: 'insert_drive_file',
  };

  private subs = new Subscription();
  private pollingActive = false;
  private tenantId = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private kbManager: KnowledgeBaseManager,
    private auth: AuthService,
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
    this.tenantId = this.auth.currentUser?.sub ?? '';
    const defRes = await this.kbManager.getDefinition(this.kbId);
    this.kbDef = defRes.data ?? null;
    this.vimeoToken = this.kbDef?.vimeoAccessToken ?? '';
    if (this.kbDef?.bedrockKnowledgeBaseId) {
      const cRes = await this.kbManager.listContentByKbId(this.kbDef.bedrockKnowledgeBaseId);
      this.content = cRes.data ?? [];
    }
    this.loading = false;
    this.startStatusPolling();
  }

  ngOnDestroy(): void { this.subs.unsubscribe(); }

  // ── Stats getters ──────────────────────────────────────────────────────────

  get totalContentCount(): number { return this.content.length; }

  get totalStorageBytes(): number {
    return this.content.reduce((sum, c) => sum + (c.fileSize ?? 0), 0);
  }

  get formattedTotalStorage(): string { return this.formatBytes(this.totalStorageBytes); }

  get processingCount(): number {
    return this.content.filter((c) => c.status === 'processing' || c.status === 'uploading').length;
  }

  get readyCount(): number {
    return this.content.filter((c) => c.status === 'ready').length;
  }

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

  // ── Filtered + sorted content ──────────────────────────────────────────────

  get filteredContent(): IKnowledgeBaseContent[] {
    const term = this.searchTerm.toLowerCase().trim();
    let result = this.content.filter((c) => {
      if (this.scopeFilter && c.scope !== this.scopeFilter) return false;
      if (this.typeFilter && c.type !== this.typeFilter) return false;
      if (term) {
        const haystack = `${c.title} ${c.sourceUrl ?? ''} ${c.description ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });

    const dir = this.sortDirection === 'asc' ? 1 : -1;
    result = [...result].sort((a, b) => {
      const valA = (a as any)[this.sortColumn] ?? '';
      const valB = (b as any)[this.sortColumn] ?? '';
      return valA < valB ? -dir : valA > valB ? dir : 0;
    });

    return result;
  }

  // ── Sort + expand ──────────────────────────────────────────────────────────

  toggleSort(column: 'title' | 'type' | 'status' | 'createdAt'): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'asc';
    }
  }

  toggleExpand(item: IKnowledgeBaseContent): void {
    this.expandedItemId = this.expandedItemId === item.id ? null : item.id;
  }

  // ── File upload ────────────────────────────────────────────────────────────

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

    const { progressSubject, promise } = this.kbManager.ingestFile(
      file, 'kb-shared', this.tenantId, bedrockKbId, 'tenant', [], this.uploadRoleLevel, this.useBDA,
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

  // ── URL / video ingestion ──────────────────────────────────────────────────

  detectVideoType(url: string): 'vimeo' | 'youtube' | null {
    if (!url) return null;
    if (/vimeo\.com/i.test(url)) return 'vimeo';
    if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
    return null;
  }

  get currentVideoType(): 'vimeo' | 'youtube' | null {
    return this.detectVideoType(this.urlForm.value.url ?? '');
  }

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
      const videoType = this.detectVideoType(url);
      let result;

      if (videoType) {
        result = await this.kbManager.ingestVideo(url, 'kb-shared', bedrockKbId, scope, minRoleLevel ?? 0, this.useBDA, this.kbId);
      } else {
        result = await this.kbManager.ingestUrl(
          { url, title: title || undefined, scope, minRoleLevel: minRoleLevel ?? 0, crawlDepth: crawlDepth ?? 1 },
          'kb-shared', this.tenantId, bedrockKbId, this.useBDA,
        );
      }

      if (!result.success) throw new Error(result.error);
      this.snackBar.open(videoType ? 'Video queued for processing' : 'URL queued for ingestion', '', { duration: 2500 });
      this.urlForm.reset({ scope: 'tenant', crawlDepth: 1 });
      this.showUrlForm = false;
      await this.reloadContent();
      this.startStatusPolling();
    } catch (e: any) {
      const videoType = this.detectVideoType(url);
      const msg = e?.message?.includes('Vimeo access token') ? e.message : (videoType ? 'Video ingestion failed' : 'URL ingestion failed');
      this.snackBar.open(msg, 'OK', { duration: 4000 });
    }
    this.urlIngesting = false;
  }

  // ── Batch URL import ───────────────────────────────────────────────────────

  get validBatchUrlCount(): number {
    if (!this.batchUrlText) return 0;
    return this.batchUrlText.split('\n').filter((l) => /^https?:\/\/.+/.test(l.trim())).length;
  }

  async ingestBatchUrls(): Promise<void> {
    const bedrockKbId = this.kbDef?.bedrockKnowledgeBaseId;
    if (!bedrockKbId || this.batchUrlIngesting) return;

    const urls = this.batchUrlText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^https?:\/\/.+/.test(line));

    if (urls.length === 0) {
      this.snackBar.open('No valid URLs found', 'OK', { duration: 3000 });
      return;
    }

    this.batchUrlIngesting = true;
    this.batchUrlTotal = urls.length;
    this.batchUrlProgress = 0;
    let successCount = 0;

    for (const url of urls) {
      try {
        const videoType = this.detectVideoType(url);
        if (videoType) {
          await this.kbManager.ingestVideo(url, 'kb-shared', bedrockKbId, 'tenant', 0, this.useBDA, this.kbId);
        } else {
          await this.kbManager.ingestUrl(
            { url, scope: 'tenant', minRoleLevel: 0, crawlDepth: 1 },
            'kb-shared', this.tenantId, bedrockKbId, this.useBDA,
          );
        }
        successCount++;
      } catch {
        // continue with next URL
      }
      this.batchUrlProgress++;
    }

    this.snackBar.open(`${successCount} of ${urls.length} URLs queued`, '', { duration: 3000 });
    this.batchUrlText = '';
    this.showBatchUrlForm = false;
    this.batchUrlIngesting = false;

    await this.reloadContent();
    this.startStatusPolling();
  }

  // ── Vimeo ──────────────────────────────────────────────────────────────────

  async saveVimeoToken(): Promise<void> {
    if (this.savingVimeoToken) return;
    this.savingVimeoToken = true;
    const result = await this.kbManager.updateDefinition(this.kbId, { vimeoAccessToken: this.vimeoToken.trim() });
    if (result.success) {
      this.kbDef = { ...this.kbDef!, vimeoAccessToken: this.vimeoToken.trim() };
      this.snackBar.open('Vimeo token saved', '', { duration: 2500 });
    } else {
      this.snackBar.open('Save failed', 'OK', { duration: 3000 });
    }
    this.savingVimeoToken = false;
  }

  browseVimeo(): void {
    const ref = this.dialog.open(VimeoBrowserDialogComponent, {
      width: '900px',
      maxHeight: '85vh',
      data: { assistantId: 'kb-shared', kbManager: this.kbManager, kbDefId: this.kbId },
    });
    ref.afterClosed().subscribe(async (selectedVideoIds: string[] | null) => {
      if (!selectedVideoIds?.length) return;
      const bedrockKbId = this.kbDef?.bedrockKnowledgeBaseId;
      if (!bedrockKbId) return;
      this.snackBar.open(`Importing ${selectedVideoIds.length} video(s)...`, '', { duration: 3000 });
      const result = await this.kbManager.bulkIngestVimeo(
        'kb-shared', bedrockKbId, selectedVideoIds, 'tenant', 0, this.useBDA, this.kbId,
      );
      if (result.success) {
        this.snackBar.open(
          `${result.data!.succeeded} of ${result.data!.total} videos queued`, '', { duration: 3000 },
        );
        await this.reloadContent();
        this.startStatusPolling();
      } else {
        this.snackBar.open('Import failed', 'OK', { duration: 3000 });
      }
    });
  }

  // ── Content management ────────────────────────────────────────────────────

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
      } else {
        this.snackBar.open('Delete failed', 'OK', { duration: 3000 });
      }
    });
  }

  editContent(item: IKnowledgeBaseContent): void {
    const ref = this.dialog.open(EditContentDialogComponent, {
      width: '480px',
      data: {
        title: item.title,
        scope: item.scope,
        minRoleLevel: item.minRoleLevel,
        tags: item.tags ?? [],
      },
    });
    ref.afterClosed().subscribe(async (result: IEditContentResult | null) => {
      if (!result) return;
      const res = await this.kbManager.updateContent(item.id, result);
      if (res.success) {
        const idx = this.content.findIndex((c) => c.id === item.id);
        if (idx >= 0) {
          if (result.title !== undefined) this.content[idx] = { ...this.content[idx], title: result.title };
          if (result.scope !== undefined) this.content[idx] = { ...this.content[idx], scope: result.scope as any };
          if (result.minRoleLevel !== undefined) this.content[idx] = { ...this.content[idx], minRoleLevel: result.minRoleLevel as any };
          if (result.tags !== undefined) this.content[idx] = { ...this.content[idx], tags: result.tags };
        }
        this.snackBar.open('Content updated', '', { duration: 2000 });
      } else {
        this.snackBar.open('Update failed', 'OK', { duration: 3000 });
      }
    });
  }

  async retryIngestion(item: IKnowledgeBaseContent): Promise<void> {
    const result = await this.kbManager.retryIngestion(item.id);
    if (result.success) {
      this.snackBar.open('Re-processing started', '', { duration: 2500 });
      await this.reloadContent();
      this.startStatusPolling();
    } else {
      this.snackBar.open('Retry failed', 'OK', { duration: 3000 });
    }
  }

  // ── Bulk selection ───────────────────────────────────────────────────────

  toggleSelect(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
  }

  selectAll(): void {
    this.filteredContent.forEach((c) => this.selectedIds.add(c.id));
  }

  deselectAll(): void {
    this.selectedIds.clear();
  }

  get allSelected(): boolean {
    return this.filteredContent.length > 0 && this.selectedIds.size === this.filteredContent.length;
  }

  bulkDelete(): void {
    const count = this.selectedIds.size;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete Selected',
        message: `Permanently remove ${count} item${count !== 1 ? 's' : ''}? This cannot be undone.`,
        confirmLabel: 'Delete All',
        destructive: true,
      } as IConfirmDialogData,
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed) return;
      const ids = Array.from(this.selectedIds);
      const result = await this.kbManager.bulkDelete(ids);
      if (result.success) {
        this.content = this.content.filter((c) => !this.selectedIds.has(c.id));
        this.snackBar.open(`${result.data?.deleted ?? count} items removed`, '', { duration: 2500 });
        this.selectedIds.clear();
      } else {
        this.snackBar.open('Bulk delete failed', 'OK', { duration: 3000 });
      }
    });
  }

  // ── S3 Content Preview ──────────────────────────────────────────────────────

  async loadPreview(item: IKnowledgeBaseContent): Promise<void> {
    this.previewItemId = item.id;
    this.previewLoading = true;
    this.previewData = null;
    const r = await this.kbManager.previewContent(item.id);
    this.previewLoading = false;
    if (r.success && r.data) {
      this.previewData = r.data;
    } else {
      this.snackBar.open('Failed to load preview', 'OK', { duration: 3000 });
      this.previewItemId = '';
    }
  }

  async loadPreviewPage(item: IKnowledgeBaseContent, offset: number): Promise<void> {
    this.previewLoading = true;
    const r = await this.kbManager.previewContent(item.id, Math.max(0, offset));
    this.previewLoading = false;
    if (r.success && r.data) {
      this.previewData = r.data;
    }
  }

  // ── Status polling ──────────────────────────────────────────────────────────

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

  // ── Utilities ──────────────────────────────────────────────────────────────

  goBack(): void { this.router.navigate(['/knowledge-bases']); }

  getIcon(type: string): string { return this.typeIcons[type] ?? 'attach_file'; }

  formatBytes(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  getRoleLabel(level: number | undefined): string {
    const entry = ROLE_ACCESS_LEVELS.find((r) => r.value === (level ?? 0));
    return entry?.label ?? 'Everyone';
  }

  getRoleBadgeClass(level: number | undefined): string {
    const map: Record<number, string> = { 0: 'role-public', 1: 'role-auth', 2: 'role-staff', 3: 'role-doctor', 4: 'role-admin' };
    return map[level ?? 0] ?? 'role-public';
  }
}
