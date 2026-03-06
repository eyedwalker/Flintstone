import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from './api.service';
import { AssistantManager } from '../../../lib/managers/assistant.manager';
import { IAssistant, ITenant } from '../../../lib/models/tenant.model';
import { environment } from '../../../environments/environment';

/**
 * Manages a site-wide demo chat widget.
 * When an admin selects a demo assistant, the widget is injected on every page.
 */
@Injectable({ providedIn: 'root' })
export class DemoWidgetService {
  private activeAssistantId: string | null = null;
  private demoActive = new BehaviorSubject<boolean>(false);
  readonly isDemoActive$ = this.demoActive.asObservable();

  constructor(
    private api: ApiService,
    private assistantManager: AssistantManager,
  ) {}

  /** Read tenant settings and inject widget if demoAssistantId is set */
  async bootstrap(): Promise<void> {
    const res = await this.api.get<ITenant>('/tenants/me');
    const demoId = res.data?.demoAssistantId;
    if (demoId) {
      await this.activate(demoId);
    }
  }

  /** Inject the widget for a given assistant */
  async activate(assistantId: string): Promise<void> {
    this.teardown();
    const res = await this.assistantManager.getAssistant(assistantId);
    if (!res.success || !res.data || res.data.status !== 'ready') return;
    this.injectWidget(res.data);
    this.activeAssistantId = assistantId;
    this.demoActive.next(true);
  }

  /** Remove the widget from the DOM and clean up globals */
  teardown(): void {
    document.getElementById('awsac-widget')?.remove();
    document.querySelectorAll('style').forEach((el) => {
      if (el.textContent?.includes('.awsac-bubble')) el.remove();
    });
    document.querySelectorAll('script').forEach((el) => {
      if ((el as HTMLScriptElement).src?.includes('aws-agent-chat')) el.remove();
    });
    const w = window as unknown as Record<string, unknown>;
    if (w['AWSAgentChat']) delete w['AWSAgentChat'];
    this.activeAssistantId = null;
    this.demoActive.next(false);
  }

  /** Save the chosen assistant to tenant settings and activate/teardown */
  async setDemoAssistant(assistantId: string | null): Promise<boolean> {
    const res = await this.api.put('/tenants/me', { demoAssistantId: assistantId ?? '' });
    if (!res.success) return false;
    if (assistantId) {
      await this.activate(assistantId);
    } else {
      this.teardown();
    }
    return true;
  }

  get currentAssistantId(): string | null {
    return this.activeAssistantId;
  }

  private injectWidget(assistant: IAssistant): void {
    const cfg = assistant.widgetConfig;
    const script = document.createElement('script');
    script.src = environment.widgetCdnUrl;
    script.onload = () => {
      const awsChat = (window as unknown as Record<string, any>)['AWSAgentChat'];
      if (!awsChat?.init) return;

      const initConfig: Record<string, unknown> = {
        apiEndpoint: environment.chatApiBaseUrl,
        apiKey: assistant.apiKey,
        position: cfg.position,
        primaryColor: cfg.primaryColor,
        secondaryColor: cfg.secondaryColor,
        title: cfg.title,
        welcomeMessage: cfg.welcomeMessage,
        placeholder: cfg.placeholder,
        showTimestamp: cfg.showTimestamp,
        persistSession: cfg.persistSession,
        zIndex: cfg.zIndex,
      };

      if (cfg.customLauncherIconUrl) initConfig['customLauncherIconUrl'] = cfg.customLauncherIconUrl;
      if (cfg.customLauncherHtml) initConfig['customLauncherHtml'] = cfg.customLauncherHtml;
      if (cfg.customCss) initConfig['customCss'] = cfg.customCss;
      if (cfg.typingIndicatorStyle && cfg.typingIndicatorStyle !== 'dots') {
        initConfig['typingIndicatorStyle'] = cfg.typingIndicatorStyle;
      }
      if (cfg.typingPhrases?.length && cfg.typingIndicatorStyle !== 'dots') {
        initConfig['typingPhrases'] = cfg.typingPhrases;
      }
      if (cfg.trendingQuestions?.length) {
        initConfig['trendingQuestions'] = cfg.trendingQuestions;
      }

      awsChat.init(initConfig);
    };
    document.head.appendChild(script);
  }
}
