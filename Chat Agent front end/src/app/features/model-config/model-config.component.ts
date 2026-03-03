import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { IBedrockModel, IModelConfig } from '../../../lib/models/tenant.model';

interface IModelGroup { label: string; color: string; models: IBedrockModel[]; }

/** Model configuration — system prompt, model picker, inference params */
@Component({
  selector: 'bcc-model-config',
  templateUrl: './model-config.component.html',
  styleUrls: ['./model-config.component.scss'],
})
export class ModelConfigComponent implements OnInit {
  assistantId = '';
  form!: FormGroup;
  loading = true;
  saving = false;
  stopSequences: string[] = [];
  selectedModel: IBedrockModel | null = null;

  readonly modelGroups: IModelGroup[] = [
    {
      label: 'Anthropic Claude', color: '#d97706',
      models: [
        { modelId: 'us.anthropic.claude-sonnet-4-6', modelName: 'Claude Sonnet 4.6', provider: 'anthropic', providerLabel: 'Anthropic', category: 'claude', contextWindow: 200000, supportsStreaming: true, inputPricePerToken: 0.000003, outputPricePerToken: 0.000015, planRequired: 'pro' },
        { modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', modelName: 'Claude Sonnet 4.5', provider: 'anthropic', providerLabel: 'Anthropic', category: 'claude', contextWindow: 200000, supportsStreaming: true, inputPricePerToken: 0.000003, outputPricePerToken: 0.000015, planRequired: 'starter' },
        { modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', modelName: 'Claude Haiku 4.5', provider: 'anthropic', providerLabel: 'Anthropic', category: 'claude', contextWindow: 200000, supportsStreaming: true, inputPricePerToken: 0.0000008, outputPricePerToken: 0.000004, planRequired: 'free' },
        { modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', modelName: 'Claude 3.5 Sonnet v2', provider: 'anthropic', providerLabel: 'Anthropic', category: 'claude', contextWindow: 200000, supportsStreaming: true, inputPricePerToken: 0.000003, outputPricePerToken: 0.000015, planRequired: 'starter' },
      ],
    },
    {
      label: 'Amazon Nova', color: '#f97316',
      models: [
        { modelId: 'us.amazon.nova-lite-v1:0', modelName: 'Nova Lite', provider: 'amazon', providerLabel: 'Amazon', category: 'nova', contextWindow: 128000, supportsStreaming: true, inputPricePerToken: 0.0000006, outputPricePerToken: 0.0000024, planRequired: 'free' },
        { modelId: 'us.amazon.nova-pro-v1:0', modelName: 'Nova Pro', provider: 'amazon', providerLabel: 'Amazon', category: 'nova', contextWindow: 300000, supportsStreaming: true, inputPricePerToken: 0.0000008, outputPricePerToken: 0.0000032, planRequired: 'starter' },
      ],
    },
    {
      label: 'Meta Llama', color: '#3b82f6',
      models: [
        { modelId: 'meta.llama3-8b-instruct-v1:0', modelName: 'Llama 3 8B Instruct', provider: 'meta', providerLabel: 'Meta', category: 'llama', contextWindow: 8192, supportsStreaming: true, inputPricePerToken: 0.0000003, outputPricePerToken: 0.0000006, planRequired: 'starter' },
        { modelId: 'meta.llama3-70b-instruct-v1:0', modelName: 'Llama 3 70B Instruct', provider: 'meta', providerLabel: 'Meta', category: 'llama', contextWindow: 8192, supportsStreaming: true, inputPricePerToken: 0.00000099, outputPricePerToken: 0.00000099, planRequired: 'pro' },
      ],
    },
    {
      label: 'Mistral AI', color: '#a855f7',
      models: [
        { modelId: 'mistral.mistral-7b-instruct-v0:2', modelName: 'Mistral 7B Instruct', provider: 'mistral', providerLabel: 'Mistral', category: 'mistral', contextWindow: 32768, supportsStreaming: true, inputPricePerToken: 0.00000015, outputPricePerToken: 0.0000002, planRequired: 'starter' },
        { modelId: 'mistral.mixtral-8x7b-instruct-v0:1', modelName: 'Mixtral 8x7B', provider: 'mistral', providerLabel: 'Mistral', category: 'mistral', contextWindow: 32768, supportsStreaming: true, inputPricePerToken: 0.00000045, outputPricePerToken: 0.0000007, planRequired: 'pro' },
      ],
    },
    {
      label: 'Self-Hosted (AWS GPU)', color: '#10b981',
      models: [
        { modelId: 'selfhosted.custom', modelName: 'Custom GPU Endpoint', provider: 'selfhosted', providerLabel: 'Self-Hosted', category: 'custom', contextWindow: 128000, supportsStreaming: true, inputPricePerToken: 0, outputPricePerToken: 0, planRequired: 'enterprise' },
      ],
    },
  ];

  constructor(
    private route: ActivatedRoute,
    private assistantManager: AssistantManager,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
  ) {}

  async ngOnInit(): Promise<void> {
    this.assistantId = this.route.snapshot.paramMap.get('id') ?? '';
    const result = await this.assistantManager.getAssistant(this.assistantId);
    const cfg: IModelConfig = result.data?.modelConfig ?? this.defaultConfig();

    this.stopSequences = [...(cfg.stopSequences ?? [])];
    this.form = this.fb.group({
      provider: [cfg.provider],
      modelId: [cfg.modelId, Validators.required],
      modelName: [cfg.modelName],
      systemPrompt: [cfg.systemPrompt, Validators.required],
      temperature: [cfg.temperature],
      topP: [cfg.topP],
      topK: [cfg.topK],
      maxTokens: [cfg.maxTokens],
      selfHostedEndpoint: [cfg.selfHostedEndpoint ?? ''],
    });

    this.selectedModel = this.findModel(cfg.modelId);
    this.loading = false;
  }

  selectModel(m: IBedrockModel): void {
    this.selectedModel = m;
    this.form.patchValue({
      modelId: m.modelId,
      modelName: m.modelName,
      provider: m.provider === 'selfhosted' ? 'selfhosted' : 'bedrock',
    });
  }

  addStopSeq(val: string): void {
    const trimmed = val.trim();
    if (trimmed && !this.stopSequences.includes(trimmed)) {
      this.stopSequences = [...this.stopSequences, trimmed];
    }
  }

  removeStopSeq(i: number): void {
    this.stopSequences = this.stopSequences.filter((_, idx) => idx !== i);
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving) return;
    this.saving = true;
    const modelConfig: IModelConfig = { ...this.form.value, stopSequences: this.stopSequences };
    const result = await this.assistantManager.updateAssistant(this.assistantId, { modelConfig });
    this.snackBar.open(result.success ? 'Model config saved' : 'Save failed', result.success ? '' : 'OK', { duration: 2500 });
    this.saving = false;
  }

  private findModel(modelId: string): IBedrockModel | null {
    for (const g of this.modelGroups) {
      const m = g.models.find((x) => x.modelId === modelId);
      if (m) return m;
    }
    return null;
  }

  private defaultConfig(): IModelConfig {
    return {
      provider: 'bedrock', modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      modelName: 'Claude Haiku 4.5', systemPrompt: 'You are a helpful assistant.',
      temperature: 0.7, topP: 0.9, topK: 250, maxTokens: 2048, stopSequences: [],
    };
  }
}
