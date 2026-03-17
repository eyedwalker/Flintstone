import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../core/services/api.service';
import { AssistantManager } from '../../../lib/managers/assistant.manager';

@Component({
  selector: 'bcc-agent-training',
  templateUrl: './agent-training.component.html',
  styleUrls: ['./agent-training.component.scss'],
})
export class AgentTrainingComponent implements OnInit {
  // Assistant selection
  assistants: Array<{ id: string; name: string }> = [];
  selectedAssistantId = '';

  // Tab data
  systemPrompt = '';
  bedrockInstruction = '';
  dataGuide = '';
  viewCatalog = '';

  // State
  loading = false;
  savingPrompt = false;
  savingGuide = false;
  promptSource: 'bedrock' | 'ddb' = 'bedrock';
  lastGuideModified = '';

  // AI Assist
  aiInstruction = '';
  aiRevising = false;
  aiTarget: 'prompt' | 'guide' = 'prompt';

  // Tips for data experts
  readonly expertTips = [
    { icon: 'edit', title: 'Corrections', example: 'The "Amount" column in InvoiceDetail is net after discounts, not gross revenue.' },
    { icon: 'rule', title: 'Business Rules', example: 'When calculating net collections, exclude TransactionTypeId 5 and 7 (internal adjustments).' },
    { icon: 'code', title: 'SQL Examples', example: 'AR aging by carrier:\nSELECT "CarrierName", SUM("ClaimTotalBalance")\nFROM DATAMART."ARMartFct_Billing"\nGROUP BY "CarrierName"' },
    { icon: 'translate', title: 'Column Meanings', example: 'DerivedStatus in Order: 1=New, 2=InProgress, 3=Complete, 4=Canceled, 5=Hold' },
    { icon: 'link', title: 'Relationships', example: 'To get provider name on an appointment, join Employee on ProviderId = EmployeeId AND _Customer = _Customer' },
    { icon: 'warning', title: 'Gotchas', example: 'The POS tables use different amount signs — negative means refund. BillingTransaction.Amount can be negative for adjustments.' },
  ];

  constructor(
    private api: ApiService,
    private assistantManager: AssistantManager,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    const res = await this.assistantManager.listAssistants();
    this.assistants = (res.data ?? []).map((a: any) => ({ id: a.id, name: a.name }));
    if (this.assistants.length > 0) {
      this.selectedAssistantId = this.assistants[0].id;
      await this.loadAll();
    }
  }

  async onAssistantChange(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    if (!this.selectedAssistantId) return;
    this.loading = true;

    const [promptRes, guideRes, catalogRes] = await Promise.all([
      this.api.get<any>('/agent-config/system-prompt', { assistantId: this.selectedAssistantId }),
      this.api.get<any>('/agent-config/data-guide', { assistantId: this.selectedAssistantId }),
      this.api.get<any>('/agent-config/view-catalog', { assistantId: this.selectedAssistantId }),
    ]);

    if (promptRes.success && promptRes.data) {
      this.bedrockInstruction = promptRes.data.bedrockInstruction ?? '';
      this.systemPrompt = promptRes.data.ddbPrompt ?? '';
      // Default to showing the Bedrock instruction (the active one)
      this.promptSource = 'bedrock';
    }
    if (guideRes.success && guideRes.data) {
      this.dataGuide = guideRes.data.content ?? '';
      this.lastGuideModified = guideRes.data.lastModified ?? '';
    }
    if (catalogRes.success && catalogRes.data) {
      this.viewCatalog = catalogRes.data.content ?? '';
    }

    this.loading = false;
  }

  get activePrompt(): string {
    return this.promptSource === 'bedrock' ? this.bedrockInstruction : this.systemPrompt;
  }

  set activePrompt(val: string) {
    if (this.promptSource === 'bedrock') {
      this.bedrockInstruction = val;
    } else {
      this.systemPrompt = val;
    }
  }

  async savePrompt(): Promise<void> {
    this.savingPrompt = true;
    const res = await this.api.put<any>('/agent-config/system-prompt', {
      assistantId: this.selectedAssistantId,
      prompt: this.activePrompt,
    });
    this.savingPrompt = false;

    if (res.success) {
      const msg = res.data?.agentUpdated
        ? 'System prompt saved and Bedrock agent updated'
        : 'System prompt saved to config (Bedrock update skipped)';
      this.snackBar.open(msg, '', { duration: 3000 });
    } else {
      this.snackBar.open('Error: ' + (res.error ?? 'Failed'), '', { duration: 4000 });
    }
  }

  async saveDataGuide(): Promise<void> {
    this.savingGuide = true;
    const res = await this.api.put<any>('/agent-config/data-guide', {
      assistantId: this.selectedAssistantId,
      content: this.dataGuide,
    });
    this.savingGuide = false;

    if (res.success) {
      this.snackBar.open('Data guide saved and KB re-ingestion triggered', '', { duration: 3000 });
      this.lastGuideModified = new Date().toISOString();
    } else {
      this.snackBar.open('Error: ' + (res.error ?? 'Failed'), '', { duration: 4000 });
    }
  }

  getPromptLineCount(): number {
    return (this.activePrompt || '').split('\n').length;
  }

  getGuideLineCount(): number {
    return (this.dataGuide || '').split('\n').length;
  }

  async aiRevise(): Promise<void> {
    if (!this.aiInstruction.trim()) return;

    this.aiRevising = true;
    const document = this.aiTarget === 'prompt' ? this.activePrompt : this.dataGuide;
    const documentType = this.aiTarget === 'prompt' ? 'system-prompt' : 'data-guide';

    const res = await this.api.post<any>('/agent-config/ai-revise', {
      document,
      instruction: this.aiInstruction,
      documentType,
    });

    this.aiRevising = false;

    if (res.success && res.data?.revised) {
      if (this.aiTarget === 'prompt') {
        this.activePrompt = res.data.revised;
      } else {
        this.dataGuide = res.data.revised;
      }
      this.snackBar.open('AI revision applied — review the changes then Save', '', { duration: 4000 });
      this.aiInstruction = '';
    } else {
      this.snackBar.open('AI revision failed: ' + (res.error ?? 'Unknown'), '', { duration: 4000 });
    }
  }
}
