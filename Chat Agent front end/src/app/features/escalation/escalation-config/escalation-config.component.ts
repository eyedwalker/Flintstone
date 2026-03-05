import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { MatChipInputEvent } from '@angular/material/chips';
import { EscalationManager } from '../../../../lib/managers/escalation.manager';
import { AssistantManager } from '../../../../lib/managers/assistant.manager';
import { IEscalationConfig, TriggerMode, AuthMode } from '../../../../lib/models/escalation.model';
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
  testResult: { success: boolean; error?: string; customFields?: string[] } | null = null;

  // Form state
  enabled = false;
  authMode: AuthMode = 'password';
  salesforceInstanceUrl = '';
  salesforceConsumerKey = '';
  salesforceUsername = '';
  privateKeyFile: File | null = null;
  // Password flow
  salesforceLoginUrl = '';
  salesforceClientId = '';
  salesforceClientSecret = '';
  salesforcePassword = '';
  salesforceSecurityToken = '';
  triggerMode: TriggerMode = 'both';
  keywords: string[] = [];
  maxTurns: number | null = null;
  casePriority = 'Medium';
  caseOrigin = 'Chat';
  caseStatus = 'New';
  caseRecordTypeId = '';
  aiAnalysisEnabled = false;
  // Custom field mapping
  customFieldsEnabled = false;
  availableCustomFields: string[] = [];
  selectedCustomFields: string[] = [];

  readonly separatorKeyCodes = [ENTER, COMMA] as const;
  readonly priorities = ['Low', 'Medium', 'High', 'Critical'];
  readonly origins = ['Chat', 'Web', 'Phone', 'Email'];
  readonly statuses = ['New', 'Working', 'Escalated'];
  // Fields the escalation engine knows how to populate
  readonly mappableFields = [
    // Standard browser diagnostics
    'Browser_Info__c', 'User_Agent__c', 'Page_Url__c',
    'Screen_Resolution__c', 'Session_Id__c', 'Environment_Type__c', 'Operating_System__c',
    // Encompass / Eyefinity host app fields
    'Host_App__c', 'Host_App_Version__c', 'Encompass_User__c', 'Encompass_User_Id__c',
    'Office_Number__c', 'Company_Id__c', 'Office_Id__c', 'EHR_Enabled__c',
    'Training_Mode__c', 'Login_Name__c', 'Practice_Location_Id__c', 'Current_Route__c',
  ];

  constructor(
    private escalationManager: EscalationManager,
    private assistantManager: AssistantManager,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const res = await this.assistantManager.listAssistants();
      console.log('[Escalation] listAssistants response:', res);
      this.assistants = (res.data ?? []).filter(a => a.status === 'ready');
      console.log('[Escalation] ready assistants:', this.assistants.length);
    } catch (err) {
      console.error('[Escalation] Failed to load assistants:', err);
      this.assistants = [];
    }
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
      this.authMode = this.config.authMode ?? 'jwt';
      this.salesforceInstanceUrl = this.config.salesforceInstanceUrl;
      this.salesforceConsumerKey = this.config.salesforceConsumerKey;
      this.salesforceUsername = this.config.salesforceUsername;
      this.salesforceLoginUrl = this.config.salesforceLoginUrl ?? '';
      this.salesforceClientId = this.config.salesforceClientId ?? '';
      this.triggerMode = this.config.triggerMode;
      this.keywords = [...(this.config.autoTriggers?.keywords ?? [])];
      this.maxTurns = this.config.autoTriggers?.maxTurns ?? null;
      this.casePriority = this.config.caseDefaults?.priority ?? 'Medium';
      this.caseOrigin = this.config.caseDefaults?.origin ?? 'Chat';
      this.caseStatus = this.config.caseDefaults?.status ?? 'New';
      this.caseRecordTypeId = this.config.caseDefaults?.recordTypeId ?? '';
      this.aiAnalysisEnabled = this.config.aiAnalysisEnabled ?? false;
      this.customFieldsEnabled = this.config.customFieldMapping?.enabled ?? false;
      this.selectedCustomFields = [...(this.config.customFieldMapping?.fields ?? [])];
    } else {
      this.resetForm();
    }
    this.loading = false;
    this.testResult = null;
  }

  resetForm(): void {
    this.enabled = false;
    this.authMode = 'password';
    this.salesforceInstanceUrl = '';
    this.salesforceConsumerKey = '';
    this.salesforceUsername = '';
    this.privateKeyFile = null;
    this.salesforceLoginUrl = '';
    this.salesforceClientId = '';
    this.salesforceClientSecret = '';
    this.salesforcePassword = '';
    this.salesforceSecurityToken = '';
    this.triggerMode = 'both';
    this.keywords = [];
    this.maxTurns = null;
    this.casePriority = 'Medium';
    this.caseOrigin = 'Chat';
    this.caseStatus = 'New';
    this.caseRecordTypeId = '';
    this.aiAnalysisEnabled = false;
    this.customFieldsEnabled = false;
    this.availableCustomFields = [];
    this.selectedCustomFields = [];
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

  toggleCustomField(field: string): void {
    const idx = this.selectedCustomFields.indexOf(field);
    if (idx >= 0) {
      this.selectedCustomFields.splice(idx, 1);
    } else {
      this.selectedCustomFields.push(field);
    }
  }

  isFieldSelected(field: string): boolean {
    return this.selectedCustomFields.includes(field);
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
      authMode: this.authMode,
      salesforceInstanceUrl: this.salesforceInstanceUrl.trim(),
      salesforceConsumerKey: this.salesforceConsumerKey.trim(),
      salesforceUsername: this.salesforceUsername.trim(),
      privateKey,
      // Password flow fields — only send if populated
      ...(this.authMode === 'password' ? {
        salesforceLoginUrl: this.salesforceLoginUrl.trim() || undefined,
        salesforceClientId: this.salesforceClientId.trim() || undefined,
        salesforceClientSecret: this.salesforceClientSecret.trim() || undefined,
        salesforcePassword: this.salesforcePassword.trim() || undefined,
        salesforceSecurityToken: this.salesforceSecurityToken.trim() || undefined,
      } : {}),
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
      customFieldMapping: {
        enabled: this.customFieldsEnabled,
        fields: this.selectedCustomFields,
      },
      aiAnalysisEnabled: this.aiAnalysisEnabled,
    });

    if (result.success) {
      this.config = result.data ?? this.config;
      this.privateKeyFile = null;
      // Clear sensitive fields after save
      this.salesforceClientSecret = '';
      this.salesforcePassword = '';
      this.salesforceSecurityToken = '';
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
    // Populate available custom fields from test response
    if (this.testResult?.customFields?.length) {
      this.availableCustomFields = this.testResult.customFields.filter(
        f => this.mappableFields.includes(f),
      );
    }
    this.testing = false;
  }

  get canTest(): boolean {
    if (!this.config) return false;
    if (this.authMode === 'password') {
      return !!this.config.hasPasswordCredentials || !!this.salesforcePassword;
    }
    return !!this.config.hasPrivateKey || !!this.privateKeyFile;
  }
}
