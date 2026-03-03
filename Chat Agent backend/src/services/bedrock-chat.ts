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

/**
 * Send a message to a Bedrock Agent and collect the full response.
 * Supports single KB (legacy IRoleFilter) or multiple KBs (IMultiKbRoleFilter).
 * When roleFilter is provided, only KB chunks whose minRoleLevel ≤ caller's roleLevel
 * are returned, enforcing document-level access control.
 */
export async function invokeAgent(
  agentId: string,
  agentAliasId: string,
  userMessage: string,
  sessionId: string,
  roleFilter?: IRoleFilter | IMultiKbRoleFilter,
): Promise<string> {
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

  const res = await client.send(new InvokeAgentCommand({
    agentId,
    agentAliasId,
    sessionId,
    inputText: userMessage,
    sessionState: sessionState as any,
  }));

  // Collect streaming chunks into a single string
  const parts: string[] = [];
  if (res.completion) {
    for await (const event of res.completion) {
      if (event.chunk?.bytes) {
        parts.push(new TextDecoder().decode(event.chunk.bytes));
      }
    }
  }
  return parts.join('');
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
