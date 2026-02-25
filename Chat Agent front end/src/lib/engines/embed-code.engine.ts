import { Injectable } from '@angular/core';
import { IAssistant, IWidgetConfig } from '../models/tenant.model';
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
}

/**
 * Engine that generates embed snippet code from widget configuration.
 * Stateless — pure transformation functions.
 */
@Injectable({ providedIn: 'root' })
export class EmbedCodeEngine {

  /** Generate the full HTML embed snippet */
  generateHtmlSnippet(assistant: IAssistant, options: IEmbedCodeOptions): string {
    const config = assistant.widgetConfig;
    const lines: string[] = [];

    lines.push(`<!-- ${assistant.name} AI Chat Widget -->`);
    lines.push(`<script src="${options.widgetCdnUrl}"></script>`);
    lines.push(`<script>`);
    lines.push(`  AWSAgentChat.init({`);
    lines.push(`    apiEndpoint: '${options.apiEndpoint}',`);

    if (options.streamingEndpoint) {
      lines.push(`    streamingEndpoint: '${options.streamingEndpoint}',`);
      lines.push(`    enableStreaming: true,`);
    }

    // Use node-scoped API key if generating for a specific hierarchy node
    const activeApiKey = options.nodeContext?.node.nodeApiKey ?? options.apiKey;
    lines.push(`    apiKey: '${activeApiKey}',`);

    // Inject tenant node context if provided
    if (options.nodeContext) {
      const { node, tenantContext } = options.nodeContext;
      lines.push(`    tenantNodeId: '${node.id}',`);
      lines.push(`    tenantOrgId: '${node.organizationId}',`);
    }
    lines.push(`    position: '${config.position}',`);
    lines.push(`    primaryColor: '${config.primaryColor}',`);
    lines.push(`    secondaryColor: '${config.secondaryColor}',`);
    lines.push(`    title: '${this.escapeString(config.title)}',`);
    lines.push(`    welcomeMessage: '${this.escapeString(config.welcomeMessage)}',`);
    lines.push(`    placeholder: '${this.escapeString(config.placeholder)}',`);
    lines.push(`    showTimestamp: ${config.showTimestamp},`);
    lines.push(`    persistSession: ${config.persistSession},`);
    lines.push(`    zIndex: ${config.zIndex},`);

    if (config.trendingQuestions.length > 0) {
      const questions = config.trendingQuestions
        .map((q) => `      '${this.escapeString(q)}'`)
        .join(',\n');
      lines.push(`    trendingQuestions: [`);
      lines.push(questions);
      lines.push(`    ],`);
    }

    const contextBlock = this.buildContextBlock(config);
    if (contextBlock) {
      lines.push(contextBlock);
    }

    lines.push(`  });`);
    lines.push(`</script>`);

    return lines.join('\n');
  }

  /** Generate a console-pasteable IIFE for testing */
  generateConsoleSnippet(assistant: IAssistant, options: IEmbedCodeOptions): string {
    const inner = this.generateHtmlSnippet(assistant, options);
    return `(function() {\n  const script = document.createElement('script');\n  script.src = '${options.widgetCdnUrl}';\n  script.onload = function() {\n    ${inner.replace(/\n/g, '\n    ')}\n  };\n  document.head.appendChild(script);\n})();`;
  }

  /** Build the context injection block if any context fields are configured */
  private buildContextBlock(config: IWidgetConfig): string {
    const hasContext =
      config.contextConfig.passCurrentUrl ||
      config.contextConfig.passUserId ||
      config.contextConfig.customFields.length > 0;

    if (!hasContext) return '';

    const lines: string[] = ['    context: {'];

    if (config.contextConfig.passCurrentUrl) {
      lines.push(`      getUrl: function() { return window.location.href; },`);
    }

    if (config.contextConfig.passUserId && config.contextConfig.userIdExpression) {
      lines.push(`      getUserId: function() { return ${config.contextConfig.userIdExpression}; },`);
    }

    config.contextConfig.customFields.forEach((field) => {
      lines.push(`      ${field.key}: function() { return ${field.expression}; },`);
    });

    lines.push(`    },`);
    return lines.join('\n');
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
