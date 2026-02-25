import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { BedrockGuardrailsAccessor } from '../../../lib/accessors/bedrock-guardrails.accessor';
import {
  IGuardrailConfig, IBlockedTopic, FilterStrength, IGuardrailTestResult,
} from '../../../lib/models/guardrails.model';
import { v4 as uuidv4 } from 'uuid';

/** Guardrails configuration — content filters, PII, topics, grounding, test panel */
@Component({
  selector: 'bcc-guardrails',
  templateUrl: './guardrails.component.html',
  styleUrls: ['./guardrails.component.scss'],
})
export class GuardrailsComponent implements OnInit {
  assistantId = '';
  loading = true;
  saving = false;
  showTestPanel = false;
  testInput = '';
  testSource: 'INPUT' | 'OUTPUT' = 'INPUT';
  testing = false;
  testResult: IGuardrailTestResult | null = null;
  profanityEnabled = false;
  customWords: string[] = [];

  readonly strengths: FilterStrength[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];

  config: IGuardrailConfig = this.defaultConfig();

  constructor(
    private route: ActivatedRoute,
    private assistantManager: AssistantManager,
    private guardrailsAccessor: BedrockGuardrailsAccessor,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    this.assistantId = this.route.snapshot.paramMap.get('id') ?? '';
    this.config.assistantId = this.assistantId;
    this.loading = false;
  }

  addTopic(): void {
    const topic: IBlockedTopic = { name: '', definition: '', examplePhrases: [], type: 'DENY' };
    this.config.blockedTopics = [...this.config.blockedTopics, topic];
  }

  removeTopic(i: number): void {
    this.config.blockedTopics = this.config.blockedTopics.filter((_, idx) => idx !== i);
  }

  updateExamples(topic: IBlockedTopic, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    topic.examplePhrases = val.split(',').map((s) => s.trim()).filter(Boolean);
  }

  addWord(val: string): void {
    const w = val.trim();
    if (w && !this.customWords.includes(w)) { this.customWords = [...this.customWords, w]; }
  }

  removeWord(i: number): void {
    this.customWords = this.customWords.filter((_, idx) => idx !== i);
  }

  async save(): Promise<void> {
    this.saving = true;
    this.config.wordFilters = [
      ...(this.profanityEnabled ? [{ text: 'PROFANITY', type: 'PROFANITY' as const }] : []),
      ...this.customWords.map((w) => ({ text: w, type: 'CUSTOM' as const })),
    ];
    try {
      if (this.config.bedrockGuardrailId) {
        await this.guardrailsAccessor.updateGuardrail(this.config.bedrockGuardrailId, this.config);
      } else {
        const result = await this.guardrailsAccessor.createGuardrail(this.config);
        if (result.success && result.data) {
          this.config.bedrockGuardrailId = result.data.guardrailId;
          await this.assistantManager.updateAssistant(this.assistantId, {
            bedrockGuardrailId: result.data.guardrailId,
          });
        }
      }
      this.snackBar.open('Guardrails saved & published', '', { duration: 2500 });
    } catch {
      this.snackBar.open('Save failed', 'OK', { duration: 3000 });
    }
    this.saving = false;
  }

  async runTest(): Promise<void> {
    if (!this.config.bedrockGuardrailId) {
      this.snackBar.open('Save guardrails first to enable testing', 'OK', { duration: 3000 });
      return;
    }
    this.testing = true;
    this.testResult = null;
    const result = await this.guardrailsAccessor.testGuardrail(
      this.config.bedrockGuardrailId,
      this.config.bedrockGuardrailVersion ?? 'DRAFT',
      this.testInput, this.testSource,
    );
    this.testResult = result.data ?? null;
    this.testing = false;
  }

  private defaultConfig(): IGuardrailConfig {
    return {
      id: uuidv4(), assistantId: '',
      name: 'Default Guardrail',
      contentFilters: [
        { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
        { type: 'VIOLENCE', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
        { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
        { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
        { type: 'MISCONDUCT', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
        { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
      ],
      blockedTopics: [],
      wordFilters: [],
      piiConfig: {
        enabled: false,
        entities: [
          { type: 'EMAIL', action: 'ANONYMIZE' },
          { type: 'PHONE', action: 'ANONYMIZE' },
          { type: 'NAME', action: 'ANONYMIZE' },
          { type: 'ADDRESS', action: 'ANONYMIZE' },
          { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
          { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
        ],
      },
      groundingConfig: { enabled: false, groundingThreshold: 0.7, relevanceThreshold: 0.7 },
      blockedInputMessage: "I'm sorry, I can't assist with that request.",
      blockedOutputMessage: "I'm sorry, I can't provide that information.",
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
