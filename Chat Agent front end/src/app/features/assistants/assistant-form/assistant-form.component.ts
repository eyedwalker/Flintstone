import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AssistantManager } from '../../../../lib/managers/assistant.manager';
import { AuthService } from '../../../core/services/auth.service';
import { IAssistant } from '../../../../lib/models/tenant.model';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

/** Create or edit an assistant — hub for all sub-config tabs */
@Component({
  selector: 'bcc-assistant-form',
  templateUrl: './assistant-form.component.html',
  styleUrls: ['./assistant-form.component.scss'],
})
export class AssistantFormComponent implements OnInit {
  form!: FormGroup;
  assistant: IAssistant | null = null;
  loading = false;
  saving = false;
  provisioning = false;
  isNew = true;
  assistantId = '';

  readonly tabs = [
    { label: 'Knowledge Base', icon: 'folder_open', path: 'knowledge-base' },
    { label: 'Model', icon: 'tune', path: 'model' },
    { label: 'Guardrails', icon: 'shield', path: 'guardrails' },
    { label: 'Widget', icon: 'widgets', path: 'widget' },
    { label: 'Embed', icon: 'code', path: 'embed' },
    { label: 'Metrics', icon: 'analytics', path: 'metrics' },
  ];

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private assistantManager: AssistantManager,
    private auth: AuthService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
  ) {}

  async ngOnInit(): Promise<void> {
    this.assistantId = this.route.snapshot.paramMap.get('id') ?? '';
    this.isNew = !this.assistantId || this.assistantId === 'new';
    this.initForm();

    if (!this.isNew) {
      this.loading = true;
      const result = await this.assistantManager.getAssistant(this.assistantId);
      this.assistant = result.data ?? null;
      if (this.assistant) {
        this.form.patchValue({
          name: this.assistant.name,
          description: this.assistant.description ?? '',
        });
        (this.assistant.allowedDomains ?? []).forEach((d) => this.domainsArray.push(this.fb.control(d)));
      }
      this.loading = false;
    }
  }

  private initForm(): void {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
      description: ['', Validators.maxLength(300)],
      domains: this.fb.array([]),
    });
  }

  get domainsArray(): FormArray {
    return this.form.get('domains') as FormArray;
  }

  addDomain(): void {
    this.domainsArray.push(this.fb.control(''));
  }

  removeDomain(i: number): void {
    this.domainsArray.removeAt(i);
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving) return;
    this.saving = true;

    const { name, description } = this.form.value;
    const allowedDomains: string[] = (this.domainsArray.value as string[]).filter(Boolean);
    const tenantId = this.auth.currentUser?.sub ?? '';

    try {
      if (this.isNew) {
        const result = await this.assistantManager.createAssistant({ tenantId, name, description });
        if (!result.success || !result.data) throw new Error(result.error);
        this.assistant = result.data;
        this.assistantId = this.assistant.id;
        this.isNew = false;
        this.snackBar.open('Assistant created', '', { duration: 2500 });
        this.router.navigate(['/assistants', this.assistantId, 'knowledge-base']);
      } else {
        await this.assistantManager.updateAssistant(this.assistantId, { name, description, allowedDomains });
        this.snackBar.open('Saved', '', { duration: 2000 });
      }
    } catch {
      this.snackBar.open('Save failed', 'OK', { duration: 4000 });
    }

    this.saving = false;
  }

  async provisionBedrock(): Promise<void> {
    if (!this.assistant) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Provision Bedrock Resources',
        message: 'This will create a Bedrock Knowledge Base, Agent, and Alias. It may take several minutes. Continue?',
        confirmLabel: 'Provision',
      },
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed || !this.assistant) return;
      this.provisioning = true;
      const result = await this.assistantManager.provisionBedrockResources(this.assistant!);
      if (result.success) {
        this.assistant = result.data ?? this.assistant;
        this.snackBar.open('Bedrock resources provisioned', '', { duration: 3000 });
      } else {
        this.snackBar.open(`Provisioning failed: ${result.error}`, 'OK', { duration: 6000 });
      }
      this.provisioning = false;
    });
  }

  async deleteAssistant(): Promise<void> {
    if (!this.assistant) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `Delete "${this.assistant.name}"`,
        message: 'This permanently deletes the assistant and all Bedrock resources. This cannot be undone.',
        confirmLabel: 'Delete',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe(async (confirmed: boolean) => {
      if (!confirmed || !this.assistant) return;
      await this.assistantManager.deleteAssistant(this.assistant!);
      this.snackBar.open('Assistant deleted', '', { duration: 2500 });
      this.router.navigate(['/assistants']);
    });
  }

  get currentPath(): string {
    return this.router.url.split('/').pop() ?? '';
  }
}
