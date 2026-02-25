import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription } from 'rxjs';
import { KnowledgeBaseManager } from '../../../lib/managers/knowledge-base.manager';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { AuthService } from '../../core/services/auth.service';
import { IAssistant } from '../../../lib/models/tenant.model';
import {
  IKnowledgeBaseContent, IUploadProgress, ContentScope, ContentType,
} from '../../../lib/models/knowledge-base.model';

interface IActiveUpload { name: string; progress: number; status: string; }

/** Knowledge Base content management — upload files, ingest URLs, manage content */
@Component({
  selector: 'bcc-knowledge-base',
  templateUrl: './knowledge-base.component.html',
  styleUrls: ['./knowledge-base.component.scss'],
})
export class KnowledgeBaseComponent implements OnInit, OnDestroy {
  assistantId = '';
  tenantId = '';
  assistant: IAssistant | null = null;
  content: IKnowledgeBaseContent[] = [];
  activeUploads: IActiveUpload[] = [];
  loading = true;
  urlForm: FormGroup;
  showUrlForm = false;
  urlIngesting = false;
  scopeFilter: ContentScope | '' = '';
  typeFilter: ContentType | '' = '';
  private subs = new Subscription();

  readonly typeIcons: Record<string, string> = {
    pdf: 'picture_as_pdf', word: 'description', excel: 'table_chart',
    powerpoint: 'slideshow', text: 'article', csv: 'grid_on',
    url: 'link', website: 'public', youtube: 'smart_display',
    vimeo: 'video_library', image: 'image', custom: 'attach_file',
  };

  constructor(
    private route: ActivatedRoute,
    private kbManager: KnowledgeBaseManager,
    private assistantManager: AssistantManager,
    private auth: AuthService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
  ) {
    this.urlForm = this.fb.group({
      url: ['', [Validators.required, Validators.pattern(/^https?:\/\/.+/)]],
      title: [''],
      scope: ['tenant', Validators.required],
    });
  }

  async ngOnInit(): Promise<void> {
    this.assistantId = this.route.snapshot.paramMap.get('id') ?? '';
    this.tenantId = this.auth.currentUser?.sub ?? '';
    const [aRes, cRes] = await Promise.all([
      this.assistantManager.getAssistant(this.assistantId),
      this.kbManager.listContent(this.assistantId),
    ]);
    this.assistant = aRes.data ?? null;
    this.content = cRes.data ?? [];
    this.loading = false;
  }

  ngOnDestroy(): void { this.subs.unsubscribe(); }

  get filteredContent(): IKnowledgeBaseContent[] {
    return this.content.filter((c) => {
      if (this.scopeFilter && c.scope !== this.scopeFilter) return false;
      if (this.typeFilter && c.type !== this.typeFilter) return false;
      return true;
    });
  }

  async onFileInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    for (const file of files) { await this.uploadFile(file); }
    input.value = '';
  }

  private async uploadFile(file: File): Promise<void> {
    const kbId = this.assistant?.bedrockKnowledgeBaseId;
    if (!kbId) {
      this.snackBar.open('Provision Bedrock resources before uploading', 'OK', { duration: 4000 });
      return;
    }
    const upload: IActiveUpload = { name: file.name, progress: 0, status: 'uploading' };
    this.activeUploads.push(upload);

    const { progressSubject, promise } = this.kbManager.ingestFile(
      file, this.assistantId, this.tenantId, kbId, 'tenant',
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
      const r = await this.kbManager.listContent(this.assistantId);
      this.content = r.data ?? [];
    }
  }

  async ingestUrl(): Promise<void> {
    if (this.urlForm.invalid || this.urlIngesting) return;
    const kbId = this.assistant?.bedrockKnowledgeBaseId;
    if (!kbId) {
      this.snackBar.open('Provision Bedrock resources before ingesting URLs', 'OK', { duration: 4000 });
      return;
    }
    this.urlIngesting = true;
    const { url, title, scope } = this.urlForm.value;
    try {
      const result = await this.kbManager.ingestUrl(
        { url, title: title || undefined, scope },
        this.assistantId, this.tenantId, kbId, kbId,
      );
      if (!result.success) throw new Error(result.error);
      this.snackBar.open('URL queued for ingestion', '', { duration: 2500 });
      this.urlForm.reset({ scope: 'tenant' });
      this.showUrlForm = false;
      const r = await this.kbManager.listContent(this.assistantId);
      this.content = r.data ?? [];
    } catch {
      this.snackBar.open('URL ingestion failed', 'OK', { duration: 4000 });
    }
    this.urlIngesting = false;
  }

  async deleteContent(item: IKnowledgeBaseContent): Promise<void> {
    const result = await this.kbManager.deleteContent(item);
    if (result.success) {
      this.content = this.content.filter((c) => c.id !== item.id);
      this.snackBar.open('Content removed', '', { duration: 2000 });
    } else {
      this.snackBar.open('Delete failed', 'OK', { duration: 3000 });
    }
  }

  formatBytes(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  getIcon(type: ContentType): string { return this.typeIcons[type] ?? 'attach_file'; }
}
