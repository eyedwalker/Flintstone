import { Injectable } from '@angular/core';
import { IAssistant, IWidgetConfig, ICustomContextField } from '../models/tenant.model';
import { IHierarchyNode, ITenantContext } from '../models/hierarchy.model';

export interface IEmbedCodeOptions {
  widgetCdnUrl: string;
  apiEndpoint: string;
  streamingEndpoint?: string;
  /** Assistant-level API key (for assistants not scoped to a node) */
  apiKey: string;
  /** Node-specific API key and context — when snippet is for a specific hierarchy node */
  nodeContext?: {
    node: IHierarchyNode;
    tenantContext: ITenantContext;
  };
  /** Escalation config for this assistant (if configured) */
  escalation?: {
    enabled: boolean;
    mode: string;
    buttonLabel?: string;
  };
}

/**
 * Engine that generates embed snippet code from widget configuration.
 * Stateless — pure transformation functions.
 */
@Injectable({ providedIn: 'root' })
export class EmbedCodeEngine {

  /** Generate the full HTML embed snippet */
  generateHtmlSnippet(assistant: IAssistant, options: IEmbedCodeOptions): string {
    const initCall = this.buildInitCall(assistant, options, '  ');
    const lines: string[] = [];
    lines.push(`<!-- ${assistant.name} AI Chat Widget -->`);
    lines.push(`<script src="${options.widgetCdnUrl}"></script>`);
    lines.push(`<script>`);
    lines.push(initCall);
    lines.push(`</script>`);
    return lines.join('\n');
  }

  /**
   * Generate a console-pasteable snippet that dynamically loads the widget
   * via a script tag injection.
   */
  generateConsoleSnippet(assistant: IAssistant, options: IEmbedCodeOptions): string {
    const initCall = this.buildInitCall(assistant, options, '    ');
    const lines: string[] = [];
    lines.push(`(function() {`);
    lines.push(`  var script = document.createElement('script');`);
    lines.push(`  script.src = '${options.widgetCdnUrl}';`);
    lines.push(`  script.onload = function() {`);
    lines.push(initCall);
    lines.push(`  };`);
    lines.push(`  document.head.appendChild(script);`);
    lines.push(`})();`);
    return lines.join('\n');
  }

  /**
   * Generate a fully self-contained inline snippet with the widget JS
   * source code embedded. Paste into the browser console to demo on any
   * site — bypasses CSP since no external scripts are loaded.
   */
  generateInlineSnippet(assistant: IAssistant, options: IEmbedCodeOptions, widgetSource: string): string {
    const initCall = this.buildInitCall(assistant, options, '');
    return widgetSource + '\n\n// === Widget Configuration ===\n' + initCall;
  }

  /**
   * Generate a self-hosted embed snippet for sites with strict CSP.
   * The client downloads the widget JS and hosts it on their own domain.
   */
  generateSelfHostedSnippet(assistant: IAssistant, options: IEmbedCodeOptions): string {
    const initCall = this.buildInitCall(assistant, options, '  ');
    const lines: string[] = [];
    lines.push(`<!--`);
    lines.push(`  SELF-HOSTED WIDGET SETUP`);
    lines.push(`  ========================`);
    lines.push(`  1. Download the widget script from:`);
    lines.push(`     ${options.widgetCdnUrl}`);
    lines.push(`  2. Host it on your own domain (e.g. /assets/aws-agent-chat.min.js)`);
    lines.push(`  3. Update the script src below to your hosted path`);
    lines.push(`-->`);
    lines.push(`<script src="/assets/aws-agent-chat.min.js"></script>`);
    lines.push(`<script>`);
    lines.push(initCall);
    lines.push(`</script>`);
    return lines.join('\n');
  }

  /** Get the CDN URL for downloading the widget script */
  getWidgetDownloadUrl(options: IEmbedCodeOptions): string {
    return options.widgetCdnUrl;
  }

  /** Build the AWSAgentChat.init({...}) call as pure JavaScript */
  private buildInitCall(assistant: IAssistant, options: IEmbedCodeOptions, indent: string): string {
    const config = assistant.widgetConfig;
    const lines: string[] = [];

    lines.push(`${indent}AWSAgentChat.init({`);
    lines.push(`${indent}  apiEndpoint: '${options.apiEndpoint}',`);

    if (options.streamingEndpoint) {
      lines.push(`${indent}  streamingEndpoint: '${options.streamingEndpoint}',`);
      lines.push(`${indent}  enableStreaming: true,`);
    }

    const activeApiKey = options.nodeContext?.node.nodeApiKey ?? options.apiKey;
    lines.push(`${indent}  apiKey: '${activeApiKey}',`);

    if (options.nodeContext) {
      const { node } = options.nodeContext;
      lines.push(`${indent}  tenantNodeId: '${node.id}',`);
      lines.push(`${indent}  tenantOrgId: '${node.organizationId}',`);
    }

    lines.push(`${indent}  position: '${config.position}',`);
    lines.push(`${indent}  primaryColor: '${config.primaryColor}',`);
    lines.push(`${indent}  secondaryColor: '${config.secondaryColor}',`);
    lines.push(`${indent}  title: '${this.escapeString(config.title)}',`);
    lines.push(`${indent}  welcomeMessage: '${this.escapeString(config.welcomeMessage)}',`);
    lines.push(`${indent}  placeholder: '${this.escapeString(config.placeholder)}',`);
    lines.push(`${indent}  showTimestamp: ${config.showTimestamp},`);
    lines.push(`${indent}  persistSession: ${config.persistSession},`);
    lines.push(`${indent}  zIndex: ${config.zIndex},`);

    if (config.customLauncherIconUrl) {
      lines.push(`${indent}  customLauncherIconUrl: '${config.customLauncherIconUrl}',`);
    }
    if (config.customLauncherHtml) {
      lines.push(`${indent}  customLauncherHtml: ${JSON.stringify(config.customLauncherHtml)},`);
    }
    if (config.customCss) {
      lines.push(`${indent}  customCss: ${JSON.stringify(config.customCss)},`);
    }

    if (config.typingIndicatorStyle && config.typingIndicatorStyle !== 'dots') {
      lines.push(`${indent}  typingIndicatorStyle: '${config.typingIndicatorStyle}',`);
    }

    if (config.typingPhrases && config.typingPhrases.length > 0 &&
        config.typingIndicatorStyle && config.typingIndicatorStyle !== 'dots') {
      const phrases = config.typingPhrases
        .map((p) => `${indent}    '${this.escapeString(p)}'`)
        .join(',\n');
      lines.push(`${indent}  typingPhrases: [`);
      lines.push(phrases);
      lines.push(`${indent}  ],`);
    }

    if (config.trendingQuestions.length > 0) {
      const questions = config.trendingQuestions
        .map((q) => `${indent}    '${this.escapeString(q)}'`)
        .join(',\n');
      lines.push(`${indent}  trendingQuestions: [`);
      lines.push(questions);
      lines.push(`${indent}  ],`);
    }

    const contextBlock = this.buildContextBlock(config, indent);
    if (contextBlock) {
      lines.push(contextBlock);
    }

    if (options.escalation?.enabled) {
      lines.push(`${indent}  escalation: {`);
      lines.push(`${indent}    enabled: true,`);
      lines.push(`${indent}    mode: '${options.escalation.mode}',`);
      if (options.escalation.buttonLabel) {
        lines.push(`${indent}    buttonLabel: '${this.escapeString(options.escalation.buttonLabel)}',`);
      }
      lines.push(`${indent}  },`);
    }

    lines.push(`${indent}});`);
    return lines.join('\n');
  }

  /** Build the context injection block if any context fields are configured */
  private buildContextBlock(config: IWidgetConfig, indent: string = '  '): string {
    const hasContext =
      config.contextConfig.passCurrentUrl ||
      config.contextConfig.passUserId ||
      config.contextConfig.customFields.length > 0;

    if (!hasContext) return '';

    const lines: string[] = [`${indent}  context: {`];

    if (config.contextConfig.passCurrentUrl) {
      lines.push(`${indent}    getUrl: function() { return window.location.href; },`);
      lines.push(`${indent}    getPageTitle: function() { return document.title; },`);
      lines.push(`${indent}    getBreadcrumb: function() { var bc = document.querySelector('nav[aria-label="breadcrumb"], .breadcrumb, ol.breadcrumb'); if (!bc) return null; var items = bc.querySelectorAll('li'); var parts = []; items.forEach(function(li) { var t = li.textContent.trim(); if (t) parts.push(t); }); return parts.length ? parts.join(' > ') : null; },`);
    }

    if (config.contextConfig.passUserId && config.contextConfig.userIdExpression) {
      lines.push(`${indent}    getUserId: function() { return ${config.contextConfig.userIdExpression}; },`);
    }

    config.contextConfig.customFields.forEach((field) => {
      const expr = this.buildContextExpression(field);
      lines.push(`${indent}    ${field.key}: function() { ${expr} },`);
    });

    lines.push(`${indent}  },`);
    return lines.join('\n');
  }

  /** Generate the appropriate JS expression for a context field based on its type */
  private buildContextExpression(field: ICustomContextField): string {
    switch (field.type) {
      case 'localStorage':
        return `return localStorage.getItem('${this.escapeString(field.expression)}')`;
      case 'sessionStorage':
        return `return sessionStorage.getItem('${this.escapeString(field.expression)}')`;
      case 'cookie':
        return `var m = document.cookie.match('(?:^|; )${this.escapeString(field.expression)}=([^;]*)'); return m ? decodeURIComponent(m[1]) : null`;
      case 'dom':
        return `var el = document.querySelector('${this.escapeString(field.expression)}'); return el ? el.textContent : null`;
      case 'userAgent':
        return `return navigator.userAgent`;
      case 'geolocation':
        return `return new Promise(function(r) { navigator.geolocation.getCurrentPosition(function(p) { r(p.coords.latitude + ',' + p.coords.longitude); }, function() { r(null); }); })`;
      default: // 'expression' or 'meta'
        return `return ${field.expression}`;
    }
  }

  /** Validate a widget configuration and return error messages */
  validateWidgetConfig(config: IWidgetConfig): string[] {
    const errors: string[] = [];

    if (!config.title?.trim()) errors.push('Title is required');
    if (!config.welcomeMessage?.trim()) errors.push('Welcome message is required');
    if (!config.primaryColor?.match(/^#[0-9A-Fa-f]{6}$/)) {
      errors.push('Primary color must be a valid hex color (e.g. #006FB4)');
    }
    if (config.zIndex < 1 || config.zIndex > 9999999) {
      errors.push('Z-index must be between 1 and 9999999');
    }
    if (config.trendingQuestions.length > 6) {
      errors.push('Maximum 6 trending questions allowed');
    }

    return errors;
  }

  /** Generate a cryptographically random API key */
  generateApiKey(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return 'bcc_' + Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private escapeString(str: string): string {
    return str.replace(/'/g, "\\'").replace(/\n/g, '\\n');
  }
}
