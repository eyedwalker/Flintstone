import { Component, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { WidgetPresetManager } from '../../../lib/managers/widget-preset.manager';
import { IWidgetConfig, IWidgetPreset, WidgetPresetConfig, WidgetPosition } from '../../../lib/models/tenant.model';
import { UiBuilderComponent } from './ui-builder/ui-builder.component';

/** Widget Configurator — live preview, colors, position, UI builder, trending questions, context */
@Component({
  selector: 'bcc-widget-configurator',
  templateUrl: './widget-configurator.component.html',
  styleUrls: ['./widget-configurator.component.scss'],
})
export class WidgetConfiguratorComponent implements OnInit {
  assistantId = '';
  form!: FormGroup;
  loading = true;
  saving = false;
  uploadingIcon = false;
  generatingCss = false;
  cssPrompt = '';
  assistant: any = null;

  // Preset management
  presets: IWidgetPreset[] = [];
  selectedPresetId = '';
  savingPreset = false;
  deletingPreset = false;

  @ViewChild(UiBuilderComponent) uiBuilder!: UiBuilderComponent;

  readonly positions: { value: WidgetPosition; label: string; icon: string }[] = [
    { value: 'bottom-right', label: 'Bottom Right', icon: 'south_east' },
    { value: 'bottom-left', label: 'Bottom Left', icon: 'south_west' },
    { value: 'top-right', label: 'Top Right', icon: 'north_east' },
    { value: 'top-left', label: 'Top Left', icon: 'north_west' },
  ];

  readonly defaultTypingPhrases: string[] = [
    'Adjusting my lenses\u2026',
    'Looking into that\u2026',
    'Focusing on your question\u2026',
    'Polishing up a response\u2026',
    'Examining the details\u2026',
    'Bringing things into focus\u2026',
    'Scanning for the best answer\u2026',
    'Fine-tuning my vision\u2026',
  ];

  constructor(
    private route: ActivatedRoute,
    private assistantManager: AssistantManager,
    private presetManager: WidgetPresetManager,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private sanitizer: DomSanitizer,
  ) {}

  async ngOnInit(): Promise<void> {
    this.assistantId = this.route.snapshot.paramMap.get('id') ?? '';
    const [result, presetResult] = await Promise.all([
      this.assistantManager.getAssistant(this.assistantId),
      this.presetManager.listPresets(),
    ]);
    this.assistant = result.data ?? null;
    this.presets = presetResult.data ?? [];
    const cfg = result.data?.widgetConfig ?? this.defaultConfig();
    this.initForm(cfg);

    this.loading = false;

    // After view init, the uiBuilder child will be available
    setTimeout(() => {
      if (this.uiBuilder) {
        this.uiBuilder.initFromConfig(cfg.customLauncherHtml ?? '', cfg.customCss ?? '');
      }
    });
  }

  private initForm(cfg: IWidgetConfig): void {
    const trendingArr = this.fb.array(
      (cfg.trendingQuestions ?? []).map((q) => this.fb.control(q, Validators.required))
    );
    const typingPhrasesArr = this.fb.array(
      (cfg.typingPhrases ?? this.defaultTypingPhrases).map((p) => this.fb.control(p))
    );
    const customFieldsArr = this.fb.array(
      (cfg.contextConfig.customFields ?? []).map((f) =>
        this.fb.group({
          key: [f.key, Validators.required],
          type: [f.type || 'expression', Validators.required],
          expression: [f.expression],
        })
      )
    );
    this.form = this.fb.group({
      position: [cfg.position, Validators.required],
      primaryColor: [cfg.primaryColor, Validators.required],
      secondaryColor: [cfg.secondaryColor],
      title: [cfg.title, Validators.required],
      welcomeMessage: [cfg.welcomeMessage, Validators.required],
      placeholder: [cfg.placeholder],
      showTimestamp: [cfg.showTimestamp],
      persistSession: [cfg.persistSession],
      enableStreaming: [cfg.enableStreaming],
      zIndex: [cfg.zIndex, [Validators.required, Validators.min(1), Validators.max(9999999)]],
      trendingQuestions: trendingArr,
      passCurrentUrl: [cfg.contextConfig.passCurrentUrl],
      passUserId: [cfg.contextConfig.passUserId],
      userIdExpression: [cfg.contextConfig.userIdExpression],
      customLauncherIconUrl: [cfg.customLauncherIconUrl ?? ''],
      customLauncherHtml: [cfg.customLauncherHtml ?? ''],
      customCss: [cfg.customCss ?? ''],
      customFields: customFieldsArr,
      typingIndicatorStyle: [cfg.typingIndicatorStyle ?? 'dots'],
      typingPhrases: typingPhrasesArr,
    });
  }

  /** Get safe HTML for launcher preview (used by preview panel) */
  get launcherPreviewHtml(): SafeHtml {
    let html = this.uiBuilder?.launcherCode
      || this.form?.get('customLauncherHtml')?.value
      || '<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    // Normalize SVG for bubble: add dimensions, force white fill
    if (/<svg\b/i.test(html) && !/\bwidth\s*=/i.test(html.match(/<svg[^>]*>/i)?.[0] ?? '')) {
      html = html.replace(/<svg\b/i, '<svg width="28" height="28"');
    }
    html = html.replace(/<svg([^>]*)fill="none"/i, '<svg$1fill="white"');
    html = html.replace(/<(path|circle|rect|polygon)(?![^>]*fill=)/gi, '<$1 fill="white"');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /** Inject custom CSS as a <style> tag into the preview area */
  get previewCssStyle(): SafeHtml {
    const css = this.form?.get('customCss')?.value || '';
    return this.sanitizer.bypassSecurityTrustHtml(`<style>${css}</style>`);
  }

  get previewConfig(): IWidgetConfig {
    const v = this.form.value;
    return {
      position: v.position,
      primaryColor: v.primaryColor,
      secondaryColor: v.secondaryColor || v.primaryColor,
      title: v.title || 'AI Assistant',
      welcomeMessage: v.welcomeMessage || 'Hello! How can I help?',
      placeholder: v.placeholder || 'Ask a question\u2026',
      launcherIcon: 'chat',
      showTimestamp: v.showTimestamp,
      persistSession: v.persistSession,
      enableStreaming: v.enableStreaming,
      zIndex: v.zIndex,
      trendingQuestions: (v.trendingQuestions as string[]).filter(Boolean),
      contextConfig: {
        passCurrentUrl: v.passCurrentUrl,
        passUserId: v.passUserId,
        userIdExpression: v.userIdExpression,
        customFields: (v.customFields || []).filter((f: any) => f.key),
      },
      customLauncherIconUrl: v.customLauncherIconUrl || undefined,
      customLauncherHtml: v.customLauncherHtml || undefined,
      customCss: v.customCss || undefined,
      typingIndicatorStyle: v.typingIndicatorStyle || 'dots',
      typingPhrases: (v.typingPhrases as string[]).filter(Boolean),
    };
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving) return;
    this.saving = true;
    const result = await this.assistantManager.updateAssistant(
      this.assistantId, { widgetConfig: this.previewConfig }
    );
    this.snackBar.open(result.success ? 'Widget saved' : 'Save failed', result.success ? '' : 'OK', { duration: 2500 });
    this.saving = false;
  }

  /** Upload a custom launcher icon image */
  async uploadIcon(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.uploadingIcon = true;
    const result = await this.assistantManager.uploadWidgetAsset(this.assistantId, file);
    if (result.success && result.data) {
      this.form.get('customLauncherIconUrl')?.setValue(result.data.publicUrl);
      this.snackBar.open('Icon uploaded', '', { duration: 2000 });
    } else {
      this.snackBar.open('Upload failed', 'OK', { duration: 3000 });
    }
    this.uploadingIcon = false;
    (event.target as HTMLInputElement).value = '';
  }

  removeIcon(): void {
    this.form.get('customLauncherIconUrl')?.setValue('');
  }

  /** Generate CSS from a design description using AI */
  async generateCss(): Promise<void> {
    const prompt = this.cssPrompt?.trim();
    if (!prompt || this.generatingCss) return;
    this.generatingCss = true;
    const currentCss = this.form.get('customCss')?.value || undefined;
    const result = await this.assistantManager.generateWidgetCss(this.assistantId, prompt, currentCss);
    if (result.success && result.data) {
      this.form.get('customCss')?.setValue(result.data.css);
      this.snackBar.open('CSS generated \u2014 review and save', '', { duration: 3000 });
    } else {
      this.snackBar.open('Generation failed', 'OK', { duration: 3000 });
    }
    this.generatingCss = false;
  }

  clearCustomCss(): void {
    this.form.get('customCss')?.setValue('');
  }

  /** Extract current visual-only fields from the form */
  private extractVisualConfig(): WidgetPresetConfig {
    const v = this.form.value;
    return {
      position: v.position,
      primaryColor: v.primaryColor,
      secondaryColor: v.secondaryColor,
      customLauncherIconUrl: v.customLauncherIconUrl || undefined,
      customLauncherHtml: v.customLauncherHtml || undefined,
      customCss: v.customCss || undefined,
      typingIndicatorStyle: v.typingIndicatorStyle || undefined,
      typingPhrases: (v.typingPhrases as string[]).filter(Boolean),
    };
  }

  /** Save current visual config as a new preset */
  async saveAsPreset(): Promise<void> {
    const name = prompt('Preset name:');
    if (!name?.trim()) return;

    this.savingPreset = true;
    const config = this.extractVisualConfig();
    const result = await this.presetManager.createPreset(name.trim(), config);
    if (result.success && result.data) {
      this.presets = [...this.presets, result.data];
      this.selectedPresetId = result.data.id;
      this.snackBar.open('Preset saved', '', { duration: 2500 });
    } else {
      this.snackBar.open('Failed to save preset', 'OK', { duration: 3000 });
    }
    this.savingPreset = false;
  }

  /** Load a preset and apply its visual fields to the form */
  applyPreset(presetId: string): void {
    if (!presetId) { this.selectedPresetId = ''; return; }
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return;

    this.selectedPresetId = presetId;

    this.form.patchValue({
      position: preset.position,
      primaryColor: preset.primaryColor,
      secondaryColor: preset.secondaryColor,
      customLauncherIconUrl: preset.customLauncherIconUrl ?? '',
      customLauncherHtml: preset.customLauncherHtml ?? '',
      customCss: preset.customCss ?? '',
      typingIndicatorStyle: preset.typingIndicatorStyle ?? 'dots',
    });

    // Rebuild typingPhrases FormArray
    const phrasesArray = this.form.get('typingPhrases') as FormArray;
    phrasesArray.clear();
    const phrases = preset.typingPhrases?.length
      ? preset.typingPhrases
      : this.defaultTypingPhrases;
    phrases.forEach(p => phrasesArray.push(this.fb.control(p)));

    // Sync UI builder
    setTimeout(() => {
      if (this.uiBuilder) {
        this.uiBuilder.initFromConfig(
          preset.customLauncherHtml ?? '',
          preset.customCss ?? ''
        );
      }
    });

    this.snackBar.open(`Loaded preset "${preset.name}"`, '', { duration: 2000 });
  }

  /** Delete the currently selected preset */
  async deletePreset(): Promise<void> {
    if (!this.selectedPresetId) return;
    const preset = this.presets.find(p => p.id === this.selectedPresetId);
    if (!preset) return;
    if (!confirm(`Delete preset "${preset.name}"?`)) return;

    this.deletingPreset = true;
    const result = await this.presetManager.deletePreset(this.selectedPresetId);
    if (result.success) {
      this.presets = this.presets.filter(p => p.id !== this.selectedPresetId);
      this.selectedPresetId = '';
      this.snackBar.open('Preset deleted', '', { duration: 2500 });
    } else {
      this.snackBar.open('Failed to delete preset', 'OK', { duration: 3000 });
    }
    this.deletingPreset = false;
  }

  private defaultConfig(): IWidgetConfig {
    return {
      position: 'bottom-right', primaryColor: '#006FB4', secondaryColor: '#004F82',
      title: 'AI Assistant', welcomeMessage: 'Hello! How can I help you today?',
      placeholder: 'Ask a question\u2026', launcherIcon: 'chat',
      showTimestamp: false, persistSession: true, enableStreaming: true, zIndex: 999999,
      trendingQuestions: [],
      contextConfig: { passCurrentUrl: true, passUserId: false, userIdExpression: '', customFields: [] },
    };
  }
}
