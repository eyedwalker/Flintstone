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
  private static readonly DEFAULT_AMELIA_SRC = 'https://eyefinity.partners.amelia.com/Amelia/ui/eyefinity/assets/amelia.js';
  private activeAssistantId: string | null = null;
  private demoActive = new BehaviorSubject<boolean>(false);
  readonly isDemoActive$ = this.demoActive.asObservable();

  private _ameliaActive = new BehaviorSubject<boolean>(false);
  readonly isAmeliaActive$ = this._ameliaActive.asObservable();

  private _ameliaScriptUrl = new BehaviorSubject<string>(DemoWidgetService.DEFAULT_AMELIA_SRC);
  readonly ameliaScriptUrl$ = this._ameliaScriptUrl.asObservable();

  constructor(
    private api: ApiService,
    private assistantManager: AssistantManager,
  ) {}

  /** Read tenant settings and inject widget(s) if demo flags are set */
  async bootstrap(): Promise<void> {
    const res = await this.api.get<ITenant>('/tenants/me');
    const demoId = res.data?.demoAssistantId;
    if (demoId) {
      await this.activate(demoId);
    }
    if (res.data?.demoAmeliaScriptUrl) {
      this._ameliaScriptUrl.next(res.data.demoAmeliaScriptUrl);
    }
    if (res.data?.demoAmeliaEnabled) {
      this.activateAmelia();
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

  /** Remove the Bedrock widget from the DOM and clean up globals */
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

  /** Remove everything — Bedrock + Amelia */
  teardownAll(): void {
    this.teardown();
    this.teardownAmelia();
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

  // ── Amelia ───────────────────────────────────────────────────

  /** Inject the competitor chat widget script */
  activateAmelia(): void {
    // Don't inject twice
    if (document.querySelector('script[data-demo-competitor]')) {
      this._ameliaActive.next(true);
      return;
    }
    const src = this._ameliaScriptUrl.value;
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = src;
    script.setAttribute('data-demo-competitor', 'true');
    document.body.appendChild(script);
    this._ameliaActive.next(true);
  }

  /** Remove competitor script + any DOM elements it created */
  teardownAmelia(): void {
    // Remove scripts
    document.querySelectorAll('script[data-demo-competitor]').forEach((el) => el.remove());
    // Remove Amelia DOM elements (common selectors)
    document.querySelectorAll(
      '[id*="amelia"], [class*="amelia"], [id*="Amelia"], [class*="Amelia"], iframe[src*="amelia"]'
    ).forEach((el) => el.remove());
    // Remove Amelia styles
    document.querySelectorAll('style').forEach((el) => {
      if (el.textContent?.includes('amelia') || el.textContent?.includes('Amelia')) el.remove();
    });
    // Clean up globals
    const w = window as unknown as Record<string, unknown>;
    for (const key of Object.keys(w)) {
      if (key.toLowerCase().includes('amelia')) {
        try { delete w[key]; } catch { /* non-configurable */ }
      }
    }
    this._ameliaActive.next(false);
  }

  /** Toggle competitor widget on/off and persist to tenant settings */
  async setAmelia(enabled: boolean): Promise<boolean> {
    const res = await this.api.put('/tenants/me', { demoAmeliaEnabled: enabled });
    if (!res.success) return false;
    if (enabled) {
      this.activateAmelia();
    } else {
      this.teardownAmelia();
    }
    return true;
  }

  /** Update the competitor widget script URL and persist */
  async setAmeliaScriptUrl(url: string): Promise<boolean> {
    const res = await this.api.put('/tenants/me', { demoAmeliaScriptUrl: url });
    if (!res.success) return false;
    this._ameliaScriptUrl.next(url);
    // If currently active, reload with new script
    if (this._ameliaActive.value) {
      this.teardownAmelia();
      this.activateAmelia();
    }
    return true;
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
