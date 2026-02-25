import {
  BedrockClient,
  CreateGuardrailCommand,
  UpdateGuardrailCommand,
  DeleteGuardrailCommand,
  CreateGuardrailVersionCommand,
} from '@aws-sdk/client-bedrock';
import { BedrockRuntimeClient, ApplyGuardrailCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockClient({ region: process.env['REGION'] ?? 'us-east-1' });
const bedrockRuntime = new BedrockRuntimeClient({ region: process.env['REGION'] ?? 'us-east-1' });

export async function createGuardrail(config: GuardrailConfig): Promise<{ guardrailId: string; version: string }> {
  const res = await bedrock.send(new CreateGuardrailCommand(buildGuardrailInput(config)));
  return { guardrailId: res.guardrailId ?? '', version: res.version ?? 'DRAFT' };
}

export async function updateGuardrail(guardrailId: string, config: GuardrailConfig): Promise<void> {
  await bedrock.send(new UpdateGuardrailCommand({
    guardrailIdentifier: guardrailId,
    ...buildGuardrailInput(config),
  }));
}

export async function deleteGuardrail(guardrailId: string): Promise<void> {
  await bedrock.send(new DeleteGuardrailCommand({ guardrailIdentifier: guardrailId }));
}

export async function createGuardrailVersion(guardrailId: string, description: string): Promise<string> {
  const res = await bedrock.send(new CreateGuardrailVersionCommand({
    guardrailIdentifier: guardrailId,
    description,
  }));
  return res.version ?? '';
}

export async function testGuardrail(
  guardrailId: string,
  version: string,
  text: string,
  source: 'INPUT' | 'OUTPUT'
): Promise<{ action: string; output?: string; assessments: unknown[] }> {
  const res = await bedrockRuntime.send(new ApplyGuardrailCommand({
    guardrailIdentifier: guardrailId,
    guardrailVersion: version,
    source,
    content: [{ text: { text } }],
  }));
  return {
    action: res.action ?? 'NONE',
    output: res.outputs?.[0]?.text,
    assessments: (res.assessments ?? []) as unknown[],
  };
}

// ── Internal helpers ──────────────────────────────────────────────

interface GuardrailConfig {
  name: string;
  blockedInputMessage?: string;
  blockedOutputMessage?: string;
  contentFilters?: Array<{ type: string; inputStrength: string; outputStrength: string }>;
  blockedTopics?: Array<{ name: string; definition: string; examplePhrases: string[]; type: string }>;
  wordFilters?: Array<{ text: string; type: string }>;
  piiConfig?: { enabled: boolean; entities: Array<{ type: string; action: string }> };
  groundingConfig?: { enabled: boolean; groundingThreshold: number; relevanceThreshold: number };
}

function buildGuardrailInput(config: GuardrailConfig) {
  return {
    name: config.name,
    blockedInputMessaging: config.blockedInputMessage ?? "I'm sorry, I can't assist with that.",
    blockedOutputsMessaging: config.blockedOutputMessage ?? "I'm sorry, I can't provide that.",
    ...(config.contentFilters?.length ? {
      contentPolicyConfig: {
        filtersConfig: config.contentFilters.map((f) => ({
          type: f.type as never,
          inputStrength: f.inputStrength as never,
          outputStrength: f.outputStrength as never,
        })),
      },
    } : {}),
    ...(config.blockedTopics?.length ? {
      topicPolicyConfig: {
        topicsConfig: config.blockedTopics.map((t) => ({
          name: t.name,
          definition: t.definition,
          examples: t.examplePhrases,
          type: 'DENY' as const,
        })),
      },
    } : {}),
    ...(config.wordFilters?.length ? {
      wordPolicyConfig: {
        wordsConfig: config.wordFilters
          .filter((w) => w.type === 'CUSTOM')
          .map((w) => ({ text: w.text })),
        managedWordListsConfig: config.wordFilters.some((w) => w.type === 'PROFANITY')
          ? [{ type: 'PROFANITY' as const }]
          : [],
      },
    } : {}),
    ...(config.piiConfig?.enabled && config.piiConfig.entities.length ? {
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: config.piiConfig.entities.map((e) => ({
          type: e.type as never,
          action: e.action as never,
        })),
      },
    } : {}),
    ...(config.groundingConfig?.enabled ? {
      contextualGroundingPolicyConfig: {
        filtersConfig: [
          { type: 'GROUNDING' as const, threshold: config.groundingConfig.groundingThreshold },
          { type: 'RELEVANCE' as const, threshold: config.groundingConfig.relevanceThreshold },
        ],
      },
    } : {}),
  };
}
