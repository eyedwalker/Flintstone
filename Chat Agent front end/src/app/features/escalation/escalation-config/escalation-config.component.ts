import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { MatChipInputEvent } from '@angular/material/chips';
import { EscalationManager } from '../../../../lib/managers/escalation.manager';
import { AssistantManager } from '../../../../lib/managers/assistant.manager';
import { IEscalationConfig, TriggerMode } from '../../../../lib/models/escalation.model';
import { IAssistant } from '../../../../lib/models/tenant.model';

@Component({
  selector: 'bcc-escalation-config',
  templateUrl: './escalation-config.component.html',
  styleUrls: ['./escalation-config.component.scss'],
})
export class EscalationConfigComponent implements OnInit {
  assistants: IAssistant[] = [];
  selectedAssistantId = '';
  config: IEscalationConfig | null = null;
  loading = true;
  saving = false;
  testing = false;
  testResult: { success: boolean; error?: string } | null = null;

  // Form state
  enabled = false;
  salesforceInstanceUrl = '';
  salesforceConsumerKey = '';
  salesforceUsername = '';
  privateKeyFile: File | null = null;
  triggerMode: TriggerMode = 'both';
  keywords: string[] = [];
  maxTurns: number | null = null;
  casePriority = 'Medium';
  caseOrigin = 'Chat';
  caseStatus = 'New';
  caseRecordTypeId = '';

  readonly separatorKeyCodes = [ENTER, COMMA] as const;
  readonly priorities = ['Low', 'Medium', 'High', 'Critical'];
  readonly origins = ['Chat', 'Web', 'Phone', 'Email'];
  readonly statuses = ['New', 'Working', 'Escalated'];

  constructor(
    private escalationManager: EscalationManager,
    private assistantManager: AssistantManager,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    const res = await this.assistantManager.listAssistants();
    this.assistants = (res.data ?? []).filter(a => a.status === 'ready');
    this.loading = false;
    if (this.assistants.length === 1) {
      this.selectedAssistantId = this.assistants[0].id;
      await this.loadConfig();
    }
  }

  async onAssistantChange(): Promise<void> {
    if (this.selectedAssistantId) {
      await this.loadConfig();
    } else {
      this.config = null;
      this.resetForm();
    }
  }

  async loadConfig(): Promise<void> {
    this.loading = true;
    const res = await this.escalationManager.getConfig(this.selectedAssistantId);
    this.config = res.data ?? null;
    if (this.config) {
      this.enabled = this.config.enabled;
      this.salesforceInstanceUrl = this.config.salesforceInstanceUrl;
      this.salesforceConsumerKey = this.config.salesforceConsumerKey;
      this.salesforceUsername = this.config.salesforceUsername;
      this.triggerMode = this.config.triggerMode;
      this.keywords = [...(this.config.autoTriggers?.keywords ?? [])];
      this.maxTurns = this.config.autoTriggers?.maxTurns ?? null;
      this.casePriority = this.config.caseDefaults?.priority ?? 'Medium';
      this.caseOrigin = this.config.caseDefaults?.origin ?? 'Chat';
      this.caseStatus = this.config.caseDefaults?.status ?? 'New';
      this.caseRecordTypeId = this.config.caseDefaults?.recordTypeId ?? '';
    } else {
      this.resetForm();
    }
    this.loading = false;
    this.testResult = null;
  }

  resetForm(): void {
    this.enabled = false;
    this.salesforceInstanceUrl = '';
    this.salesforceConsumerKey = '';
    this.salesforceUsername = '';
    this.privateKeyFile = null;
    this.triggerMode = 'both';
    this.keywords = [];
    this.maxTurns = null;
    this.casePriority = 'Medium';
    this.caseOrigin = 'Chat';
    this.caseStatus = 'New';
    this.caseRecordTypeId = '';
  }

  onKeyFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.privateKeyFile = input.files?.[0] ?? null;
  }

  addKeyword(event: MatChipInputEvent): void {
    const value = (event.value || '').trim();
    if (value) this.keywords.push(value);
    event.chipInput!.clear();
  }

  removeKeyword(kw: string): void {
    this.keywords = this.keywords.filter(k => k !== kw);
  }

  async save(): Promise<void> {
    if (!this.selectedAssistantId || this.saving) return;
    this.saving = true;

    let privateKey: string | undefined;
    if (this.privateKeyFile) {
      privateKey = await this.privateKeyFile.text();
    }

    const result = await this.escalationManager.saveConfig(this.selectedAssistantId, {
      enabled: this.enabled,
      salesforceInstanceUrl: this.salesforceInstanceUrl.trim(),
      salesforceConsumerKey: this.salesforceConsumerKey.trim(),
      salesforceUsername: this.salesforceUsername.trim(),
      privateKey,
      triggerMode: this.triggerMode,
      autoTriggers: {
        keywords: this.keywords,
        maxTurns: this.maxTurns ?? undefined,
      },
      caseDefaults: {
        priority: this.casePriority,
        origin: this.caseOrigin,
        status: this.caseStatus,
        recordTypeId: this.caseRecordTypeId || undefined,
      },
    });

    if (result.success) {
      this.config = result.data ?? this.config;
      this.privateKeyFile = null;
      this.snackBar.open('Escalation config saved', '', { duration: 2500 });
    } else {
      this.snackBar.open('Save failed', 'OK', { duration: 4000 });
    }
    this.saving = false;
  }

  async testConnection(): Promise<void> {
    if (!this.selectedAssistantId || this.testing) return;
    this.testing = true;
    this.testResult = null;
    const result = await this.escalationManager.testConnection(this.selectedAssistantId);
    this.testResult = result.data ?? { success: false, error: result.error };
    this.testing = false;
  }

  get canTest(): boolean {
    return !!this.config && (!!this.config.hasPrivateKey || !!this.privateKeyFile);
  }
}
