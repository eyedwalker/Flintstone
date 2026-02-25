import { Injectable } from '@angular/core';
import {
  IGuardrailConfig,
  IBlockedTopic,
  IContentFilter,
  IWordFilter,
  ContentFilterType,
} from '../models/guardrails.model';

/** Preset guardrail template */
export interface IGuardrailTemplate {
  id: string;
  name: string;
  description: string;
  config: Partial<IGuardrailConfig>;
}

/**
 * Engine for guardrail validation and preset management.
 * Stateless — pure business logic.
 */
@Injectable({ providedIn: 'root' })
export class GuardrailsEngine {

  /** Validate a guardrail configuration, returning error messages */
  validateConfig(config: IGuardrailConfig): string[] {
    const errors: string[] = [];

    if (!config.name?.trim()) errors.push('Guardrail name is required');
    if (!config.blockedInputMessage?.trim()) errors.push('Blocked input message is required');
    if (!config.blockedOutputMessage?.trim()) errors.push('Blocked output message is required');

    config.blockedTopics.forEach((topic, i) => {
      if (!topic.name?.trim()) errors.push(`Topic ${i + 1}: name is required`);
      if (!topic.definition?.trim()) errors.push(`Topic ${i + 1}: definition is required`);
    });

    if (config.groundingConfig.enabled) {
      const { groundingThreshold, relevanceThreshold } = config.groundingConfig;
      if (groundingThreshold < 0 || groundingThreshold > 1) {
        errors.push('Grounding threshold must be between 0 and 1');
      }
      if (relevanceThreshold < 0 || relevanceThreshold > 1) {
        errors.push('Relevance threshold must be between 0 and 1');
      }
    }

    return errors;
  }

  /** Check if two topics have conflicting definitions */
  detectTopicConflicts(topics: IBlockedTopic[]): string[] {
    const warnings: string[] = [];
    const names = topics.map((t) => t.name.toLowerCase());
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    duplicates.forEach((dup) => {
      warnings.push(`Duplicate blocked topic: "${dup}"`);
    });
    return warnings;
  }

  /** Get predefined guardrail templates */
  getTemplates(): IGuardrailTemplate[] {
    return [
      {
        id: 'customer-support',
        name: 'Customer Support',
        description: 'Safe defaults for customer-facing support bots',
        config: {
          contentFilters: this.buildStandardContentFilters('MEDIUM'),
          blockedTopics: [],
          wordFilters: [{ text: 'competitor', type: 'CUSTOM' }],
          piiConfig: { enabled: true, entities: [
            { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'ANONYMIZE' },
            { type: 'EMAIL', action: 'ANONYMIZE' },
            { type: 'PHONE', action: 'ANONYMIZE' },
          ]},
          groundingConfig: { enabled: true, groundingThreshold: 0.7, relevanceThreshold: 0.7 },
          blockedInputMessage: 'I cannot help with that request.',
          blockedOutputMessage: 'I cannot provide that information.',
        },
      },
      {
        id: 'internal-kb',
        name: 'Internal Knowledge Base',
        description: 'Permissive config for internal employee tools',
        config: {
          contentFilters: this.buildStandardContentFilters('LOW'),
          blockedTopics: [],
          wordFilters: [],
          piiConfig: { enabled: false, entities: [] },
          groundingConfig: { enabled: true, groundingThreshold: 0.5, relevanceThreshold: 0.5 },
          blockedInputMessage: 'That topic is outside my scope.',
          blockedOutputMessage: 'I cannot provide that response.',
        },
      },
      {
        id: 'strict-compliance',
        name: 'Strict Compliance',
        description: 'High-sensitivity filtering for regulated industries',
        config: {
          contentFilters: this.buildStandardContentFilters('HIGH'),
          blockedTopics: [],
          wordFilters: [{ text: 'profanity', type: 'PROFANITY' }],
          piiConfig: { enabled: true, entities: [
            { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
            { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
            { type: 'EMAIL', action: 'ANONYMIZE' },
            { type: 'PHONE', action: 'ANONYMIZE' },
            { type: 'NAME', action: 'ANONYMIZE' },
          ]},
          groundingConfig: { enabled: true, groundingThreshold: 0.9, relevanceThreshold: 0.9 },
          blockedInputMessage: 'This request cannot be processed.',
          blockedOutputMessage: 'This content cannot be shared.',
        },
      },
    ];
  }

  /** Build standard content filter set at a given strength */
  private buildStandardContentFilters(strength: 'LOW' | 'MEDIUM' | 'HIGH'): IContentFilter[] {
    const types: ContentFilterType[] = ['SEXUAL', 'VIOLENCE', 'HATE', 'INSULTS', 'MISCONDUCT', 'PROMPT_ATTACK'];
    return types.map((type) => ({
      type,
      inputStrength: strength,
      outputStrength: strength,
    }));
  }

  /** Get a human-readable label for filter strength */
  getStrengthLabel(strength: string): string {
    const labels: Record<string, string> = {
      NONE: 'Off',
      LOW: 'Low',
      MEDIUM: 'Medium',
      HIGH: 'High',
    };
    return labels[strength] ?? strength;
  }

  /** Get word count of a word filter list */
  getWordFilterCount(filters: IWordFilter[]): number {
    return filters.filter((f) => f.type === 'CUSTOM').length;
  }

  /** Check if profanity filter is enabled */
  hasProfanityFilter(filters: IWordFilter[]): boolean {
    return filters.some((f) => f.type === 'PROFANITY');
  }
}
