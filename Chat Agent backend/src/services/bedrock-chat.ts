import {
  BedrockAgentRuntimeClient,
  InvokeAgentCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const REGION = process.env['REGION'] ?? 'us-west-2';
const client = new BedrockAgentRuntimeClient({ region: REGION });

export interface IRoleFilter {
  knowledgeBaseId: string;
  /** Max role level the caller is allowed to see (0=public … 4=admin) */
  roleLevel: number;
}

export interface IMultiKbRoleFilter {
  knowledgeBaseIds: string[];
  roleLevel: number;
}

/** Structured action group call extracted from Bedrock Agent traces */
export interface IActionGroupCall {
  actionGroupName: string;
  apiPath?: string;
  verb?: string;
  parameters?: Array<{ name: string; type?: string; value?: string }>;
  result?: string;
}

/** Full result from invokeAgent including text and optional trace data */
export interface IAgentResult {
  text: string;
  sessionId?: string;
  actionGroupCalls?: IActionGroupCall[];
}

/**
 * Send a message to a Bedrock Agent and collect the full response.
 * Supports single KB (legacy IRoleFilter) or multiple KBs (IMultiKbRoleFilter).
 * When roleFilter is provided, only KB chunks whose minRoleLevel ≤ caller's roleLevel
 * are returned, enforcing document-level access control.
 *
 * Returns structured result with text and any action group calls from traces.
 */
export async function invokeAgent(
  agentId: string,
  agentAliasId: string,
  userMessage: string,
  sessionId: string,
  roleFilter?: IRoleFilter | IMultiKbRoleFilter,
  tenantId?: string,
): Promise<IAgentResult> {
  let sessionState: Record<string, unknown> | undefined;

  if (roleFilter) {
    const kbIds = 'knowledgeBaseIds' in roleFilter
      ? roleFilter.knowledgeBaseIds
      : [roleFilter.knowledgeBaseId];

    sessionState = {
      knowledgeBaseConfigurations: kbIds.map(kbId => ({
        knowledgeBaseId: kbId,
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            filter: {
              lessThanOrEquals: {
                key: 'minRoleLevel',
                value: roleFilter.roleLevel,
              },
            },
          },
        },
      })),
    };
  }

  // Merge sessionAttributes (tenantId) into sessionState for action group access
  const mergedSessionState: Record<string, unknown> = {
    ...(sessionState ?? {}),
    ...(tenantId ? { sessionAttributes: { tenantId } } : {}),
  };

  const res = await client.send(new InvokeAgentCommand({
    agentId,
    agentAliasId,
    sessionId,
    inputText: userMessage,
    enableTrace: true,
    sessionState: Object.keys(mergedSessionState).length > 0 ? mergedSessionState as any : undefined,
  }));

  // Collect streaming chunks and trace events
  const parts: string[] = [];
  const pendingCalls = new Map<string, IActionGroupCall>();
  const completedCalls: IActionGroupCall[] = [];

  if (res.completion) {
    for await (const event of res.completion) {
      if (event.chunk?.bytes) {
        parts.push(new TextDecoder().decode(event.chunk.bytes));
      }

      // Extract action group calls from orchestration traces
      if (event.trace?.trace?.orchestrationTrace) {
        const ot = event.trace.trace.orchestrationTrace as any;

        // Invocation input — agent is about to call an action group
        if (ot.invocationInput?.actionGroupInvocationInput) {
          const agi = ot.invocationInput.actionGroupInvocationInput;
          const id = ot.invocationInput.invocationId ?? agi.apiPath ?? 'unknown';
          pendingCalls.set(id, {
            actionGroupName: agi.actionGroupName ?? '',
            apiPath: agi.apiPath,
            verb: agi.verb,
            parameters: agi.parameters,
          });
        }

        // Observation — result came back from the action group
        if (ot.observation?.actionGroupInvocationOutput) {
          const out = ot.observation.actionGroupInvocationOutput;
          const id = ot.observation.traceId ?? '';
          // Match with pending call or create standalone
          const pending = [...pendingCalls.values()].pop();
          if (pending) {
            pending.result = out.text;
            completedCalls.push(pending);
            // Remove from pending
            const key = [...pendingCalls.entries()].find(([, v]) => v === pending)?.[0];
            if (key) pendingCalls.delete(key);
          } else {
            completedCalls.push({
              actionGroupName: 'unknown',
              result: out.text,
            });
          }
        }
      }
    }
  }

  // Add any remaining pending calls (invoked but no observation yet)
  for (const call of pendingCalls.values()) {
    completedCalls.push(call);
  }

  return {
    text: parts.join(''),
    actionGroupCalls: completedCalls.length > 0 ? completedCalls : undefined,
  };
}

/**
 * Invoke a Bedrock model directly (not via agent) for utility tasks like CSS generation.
 */
/**
 * Describe an image using Bedrock's vision model (Claude Haiku 4.5).
 * Accepts a base64 data URL (data:image/...;base64,...) and optional user prompt.
 */
/** Default model for quick tasks */
const HAIKU_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
/** Higher-quality model for code generation and vision tasks */
const SONNET_MODEL = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

export async function describeImage(
  base64DataUrl: string,
  userPrompt?: string,
  systemPrompt?: string,
  maxTokens?: number,
  useSonnet?: boolean,
): Promise<string> {
  const runtimeClient = new BedrockRuntimeClient({ region: REGION });
  // Support image/svg+xml and similar compound MIME types
  const match = base64DataUrl.match(/^data:(image\/[\w+.\-]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data URL');
  const [, mediaType, data] = match;

  const body: Record<string, unknown> = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens ?? 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: userPrompt || 'Describe this image in detail.' },
      ],
    }],
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const cmd = new InvokeModelCommand({
    modelId: useSonnet ? SONNET_MODEL : HAIKU_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });
  const res = await runtimeClient.send(cmd);
  const parsed = JSON.parse(new TextDecoder().decode(res.body));
  return parsed.content?.[0]?.text ?? 'Unable to describe image.';
}

/**
 * Fast KB-only path — bypasses the Bedrock Agent entirely.
 * Uses RetrieveAndGenerate with Haiku for simple help/KB questions.
 * ~2-3x faster than going through the full agent pipeline.
 */
export async function fastKbQuery(
  knowledgeBaseId: string,
  userMessage: string,
  sessionId?: string,
  systemPrompt?: string,
): Promise<IAgentResult> {
  const { BedrockAgentRuntimeClient, RetrieveAndGenerateCommand } = await import('@aws-sdk/client-bedrock-agent-runtime');
  const ragClient = new BedrockAgentRuntimeClient({ region: REGION });

  const cmd = new RetrieveAndGenerateCommand({
    input: { text: userMessage },
    retrieveAndGenerateConfiguration: {
      type: 'KNOWLEDGE_BASE',
      knowledgeBaseConfiguration: {
        knowledgeBaseId,
        modelArn: `arn:aws:bedrock:${REGION}::foundation-model/${HAIKU_MODEL}`,
        generationConfiguration: {
          ...(systemPrompt ? { promptTemplate: { textPromptTemplate: `${systemPrompt}\n\n$search_results$\n\nUser question: $query$` } } : {}),
        },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults: 5,
          },
        },
      },
    },
    ...(sessionId ? { sessionId } : {}),
  });

  const res = await ragClient.send(cmd);
  const text = res.output?.text ?? 'I couldn\'t find an answer to that question.';

  return {
    text,
    sessionId: res.sessionId ?? sessionId ?? '',
  };
}

/**
 * Check if a message is a simple help/KB question (no reporting/analytics intent).
 * Used to decide whether to use the fast KB path vs full agent.
 */
export function isSimpleHelpQuery(message: string): boolean {
  const lower = message.toLowerCase();

  // Reporting keywords — need full agent with Snowflake
  const reportingKeywords = [
    'revenue', 'sales', 'report', 'chart', 'graph', 'analytics', 'data',
    'show me', 'how many', 'total', 'average', 'trend', 'compare',
    'top', 'bottom', 'rank', 'office', 'provider', 'monthly', 'weekly',
    'quarterly', 'year', 'patient count', 'volume', 'billing', 'claims',
    'collections', 'appointments count', 'schedule report', 'export',
    'download', 'sql', 'query', 'table', 'column',
  ];

  // Front office keywords — need full agent with action groups
  const frontOfficeKeywords = [
    'book', 'schedule', 'appointment', 'cancel', 'reschedule',
    'send sms', 'send text', 'send email', 'call', 'patient lookup',
    'find patient', 'create patient',
  ];

  for (const kw of [...reportingKeywords, ...frontOfficeKeywords]) {
    if (lower.includes(kw)) return false;
  }

  return true;
}

export async function invokeModel(
  systemPrompt: string,
  userMessage: string,
  useSonnet?: boolean,
): Promise<string> {
  const runtimeClient = new BedrockRuntimeClient({ region: REGION });
  const cmd = new InvokeModelCommand({
    modelId: useSonnet ? SONNET_MODEL : HAIKU_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  const res = await runtimeClient.send(cmd);
  const parsed = JSON.parse(new TextDecoder().decode(res.body));
  return parsed.content?.[0]?.text ?? '';
}
