import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { IWidgetConfig, WidgetPosition } from '../../../lib/models/tenant.model';

/** Widget Configurator — live preview, colors, position, trending questions, context */
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

  readonly positions: { value: WidgetPosition; label: string; icon: string }[] = [
    { value: 'bottom-right', label: 'Bottom Right', icon: 'south_east' },
    { value: 'bottom-left', label: 'Bottom Left', icon: 'south_west' },
    { value: 'top-right', label: 'Top Right', icon: 'north_east' },
    { value: 'top-left', label: 'Top Left', icon: 'north_west' },
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
    const cfg = result.data?.widgetConfig ?? this.defaultConfig();
    this.initForm(cfg);
    this.loading = false;
  }

  private initForm(cfg: IWidgetConfig): void {
    const trendingArr = this.fb.array(
      (cfg.trendingQuestions ?? []).map((q) => this.fb.control(q, Validators.required))
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
    });
  }

  get trendingArray(): FormArray {
    return this.form.get('trendingQuestions') as FormArray;
  }

  addQuestion(): void {
    if (this.trendingArray.length >= 6) return;
    this.trendingArray.push(this.fb.control('', Validators.required));
  }

  removeQuestion(i: number): void {
    this.trendingArray.removeAt(i);
  }

  get previewConfig(): IWidgetConfig {
    const v = this.form.value;
    return {
      position: v.position,
      primaryColor: v.primaryColor,
      secondaryColor: v.secondaryColor || v.primaryColor,
      title: v.title || 'AI Assistant',
      welcomeMessage: v.welcomeMessage || 'Hello! How can I help?',
      placeholder: v.placeholder || 'Ask a question…',
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
        customFields: [],
      },
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

  private defaultConfig(): IWidgetConfig {
    return {
      position: 'bottom-right', primaryColor: '#006FB4', secondaryColor: '#004F82',
      title: 'AI Assistant', welcomeMessage: 'Hello! How can I help you today?',
      placeholder: 'Ask a question…', launcherIcon: 'chat',
      showTimestamp: false, persistSession: true, enableStreaming: true, zIndex: 999999,
      trendingQuestions: [],
      contextConfig: { passCurrentUrl: true, passUserId: false, userIdExpression: '', customFields: [] },
    };
  }
}
