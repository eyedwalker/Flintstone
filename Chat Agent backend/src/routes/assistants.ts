import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import * as ddb from '../services/dynamo';
import * as s3 from '../services/s3';
import * as bedrockChat from '../services/bedrock-chat';
import { ok, created, noContent, badRequest, forbidden, notFound, serverError } from '../response';
import { IRequestContext, requireRole, assertOwnership, parseBody } from '../auth';

const TABLE = process.env['ASSISTANTS_TABLE'] ?? '';
const ASSISTANT_KB_TABLE = process.env['ASSISTANT_KB_TABLE'] ?? '';
const KB_DEFS_TABLE = process.env['KNOWLEDGE_BASES_TABLE'] ?? '';
const BUCKET = process.env['S3_CONTENT_BUCKET'] ?? '';
const REGION = process.env['REGION'] ?? 'us-west-2';

interface IAssistantKbLink {
  assistantId: string;
  knowledgeBaseId: string;
  tenantId: string;
  linkedAt: string;
}

interface IKbDefSummary {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  bedrockKnowledgeBaseId?: string;
  status: string;
}

interface IAssistant {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  status: string;
  modelConfig: Record<string, unknown>;
  widgetConfig: Record<string, unknown>;
  apiKey: string;
  allowedDomains: string[];
  createdAt: string;
  updatedAt: string;
  bedrockAgentId?: string;
  bedrockAgentAliasId?: string;
  bedrockKnowledgeBaseId?: string;
  bedrockGuardrailId?: string;
  bedrockGuardrailVersion?: string;
  vimeoAccessToken?: string;
}

export async function handleAssistants(
  method: string,
  path: string,
  body: Record<string, unknown>,
  params: Record<string, string>,
  _query: Record<string, string>,
  ctx: IRequestContext
): Promise<APIGatewayProxyResultV2> {
  const tenantId = ctx.organizationId;
  try {
    const id = params['id'];

    // LIST  GET /assistants — viewer+
    if (method === 'GET' && !id) {
      if (!requireRole(ctx, 'viewer')) return forbidden('Insufficient role');
      const items = await ddb.queryItems<IAssistant>(
        TABLE,
        '#t = :t',
        { ':t': tenantId },
        { '#t': 'tenantId' },
        'tenantId-index'
      );
      return ok(items);
    }

    // GET /assistants/:id — viewer+ (but not sub-paths like /knowledge-bases)
    if (method === 'GET' && id && !path.includes('/knowledge-bases')) {
      if (!requireRole(ctx, 'viewer')) return forbidden('Insufficient role');
      const item = await ddb.getItem<IAssistant>(TABLE, { id });
      if (!item) return notFound('Assistant not found');
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();
      return ok(item);
    }

    // POST /assistants — admin+
    if (method === 'POST' && !id) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const b = parseBody<{ name: string; description?: string }>(JSON.stringify(body));
      if (!b?.name) return badRequest('name is required');
      const now = new Date().toISOString();
      const assistant: IAssistant = {
        id: uuidv4(),
        tenantId,
        name: b.name,
        description: b.description,
        status: 'draft',
        modelConfig: {
          provider: 'bedrock',
          modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
          modelName: 'Claude Haiku 4.5',
          systemPrompt: `You are a helpful AI assistant for ${b.name}.`,
          temperature: 0.7, topP: 0.9, topK: 250, maxTokens: 2048, stopSequences: [],
        },
        widgetConfig: {
          position: 'bottom-right',
          primaryColor: '#006FB4',
          secondaryColor: '#004F82',
          title: b.name,
          welcomeMessage: 'Hello! How can I help you today?',
          placeholder: 'Ask a question...',
          launcherIcon: 'chat',
          showTimestamp: false,
          persistSession: true,
          enableStreaming: true,
          zIndex: 999999,
          trendingQuestions: [],
          contextConfig: { passCurrentUrl: true, passUserId: false, userIdExpression: '', customFields: [] },
        },
        apiKey: `bca_${uuidv4().replace(/-/g, '')}`,
        allowedDomains: [],
        createdAt: now,
        updatedAt: now,
      };
      await ddb.putItem(TABLE, assistant as unknown as Record<string, unknown>);
      return created(assistant);
    }

    // PUT /assistants/:id — editor+ (but not sub-paths)
    if (method === 'PUT' && id && !path.includes('/knowledge-bases')) {
      if (!requireRole(ctx, 'editor')) return forbidden('Editor role required');
      const item = await ddb.getItem<IAssistant>(TABLE, { id });
      if (!item) return notFound('Assistant not found');
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();
      const updates: Record<string, unknown> = { ...body, updatedAt: new Date().toISOString() };
      delete updates['id'];
      delete updates['tenantId'];
      await ddb.updateItem(TABLE, { id }, updates);
      return ok({ ...item, ...updates });
    }

    // DELETE /assistants/:id — admin+ (but not sub-paths like /knowledge-bases/:kbId)
    if (method === 'DELETE' && id && !path.includes('/knowledge-bases')) {
      if (!requireRole(ctx, 'admin')) return forbidden('Admin role required');
      const item = await ddb.getItem<IAssistant>(TABLE, { id });
      if (!item) return notFound('Assistant not found');
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();
      await ddb.deleteItem(TABLE, { id });
      return noContent();
    }

    // POST /assistants/:id/upload-asset — presigned URL for widget asset upload
    if (method === 'POST' && path.endsWith('/upload-asset')) {
      const item = await ddb.getItem<IAssistant>(TABLE, { id: id! });
      if (!item) return notFound();
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();

      const b = parseBody<{ fileName: string; contentType: string }>(JSON.stringify(body));
      if (!b?.fileName || !b?.contentType) return badRequest('fileName and contentType required');

      const s3Key = `widget-assets/${tenantId}/${id}/${b.fileName}`;
      const uploadUrl = await s3.getUploadUrl(s3Key, b.contentType);
      const publicUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${s3Key}`;

      return ok({ uploadUrl, s3Key, publicUrl });
    }

    // POST /assistants/:id/generate-css — AI-generated widget CSS from prompt
    if (method === 'POST' && path.endsWith('/generate-css')) {
      const item = await ddb.getItem<IAssistant>(TABLE, { id: id! });
      if (!item) return notFound();
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();

      const b = parseBody<{ prompt: string; currentCss?: string }>(JSON.stringify(body));
      if (!b?.prompt) return badRequest('prompt is required');

      const systemPrompt = [
        'You are a CSS expert. Generate CSS that customizes a chat widget.',
        'The widget uses these CSS classes:',
        '- .awsac-bubble: the floating launcher button (56px circle)',
        '- .awsac-panel: the chat panel container (380x520px, border-radius 12px)',
        '- .awsac-header: the header bar with title',
        '- .awsac-messages: the message list area',
        '- .awsac-msg.user: user message bubbles',
        '- .awsac-msg.assistant: assistant message bubbles',
        '- .awsac-input-wrap: the input area at the bottom',
        '- .awsac-input: the textarea input',
        '- .awsac-send: the send button',
        '- .awsac-powered: the powered-by footer',
        '',
        'Return ONLY valid CSS. No explanation, no markdown fences. Just the CSS rules.',
        b.currentCss ? `\nCurrent custom CSS:\n${b.currentCss}` : '',
      ].join('\n');

      const css = await bedrockChat.invokeModel(systemPrompt, b.prompt);
      return ok({ css });
    }

    // POST /assistants/:id/generate-ui — AI-generated widget UI code from text or image
    if (method === 'POST' && path.endsWith('/generate-ui')) {
      const item = await ddb.getItem<IAssistant>(TABLE, { id: id! });
      if (!item) return notFound();
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();

      const b = parseBody<{
        component: 'launcher' | 'chat';
        prompt?: string;
        image?: string;
        currentCode?: string;
      }>(JSON.stringify(body));
      if (!b?.component) return badRequest('component is required (launcher or chat)');
      if (!b.prompt && !b.image) return badRequest('prompt or image is required');

      const launcherContext = [
        'You are an expert UI/UX designer and frontend developer specializing in chat widget design.',
        'Your task: Generate production-quality HTML and CSS for a floating chat widget LAUNCHER BUTTON.',
        '',
        'TECHNICAL CONTEXT:',
        '- The launcher is a floating button positioned in the corner of a website.',
        '- Your HTML replaces the inner content of the .awsac-bubble container element.',
        '- The .awsac-bubble container already has: position:fixed, cursor:pointer, z-index, display:flex, align-items:center, justify-content:center.',
        '- Default size is 56x56px with border-radius:50% — you can override these in CSS.',
        '',
        'CSS CLASS TO STYLE:',
        '- .awsac-bubble — the outermost launcher container',
        '',
        'QUALITY REQUIREMENTS:',
        '- Use inline SVG icons (not external images). SVGs should be clean with viewBox="0 0 24 24".',
        '- CSS must be well-formatted with each property on its own line.',
        '- Use modern CSS: gradients, box-shadow, transitions, animations where appropriate.',
        '- Include hover states (e.g., .awsac-bubble:hover) for interactivity.',
        '- Ensure high contrast and visual clarity at 56px size.',
        '- Use white (#fff) or light colors for icons/text on colored backgrounds.',
        '',
        'OUTPUT FORMAT:',
        'Return ONLY a valid JSON object with two keys:',
        '  "html" — the inner HTML (SVG icons, spans, etc.)',
        '  "css"  — CSS rules with proper newlines between declarations',
        'No explanation, no markdown fences, no comments outside JSON.',
        '',
        'EXAMPLE OUTPUT:',
        '{"html":"<svg width=\\"24\\" height=\\"24\\" viewBox=\\"0 0 24 24\\" fill=\\"white\\"><path d=\\"M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z\\"/></svg>","css":".awsac-bubble {\\n  width: 60px;\\n  height: 60px;\\n  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\\n  box-shadow: 0 4px 15px rgba(102,126,234,0.4);\\n  transition: transform 0.2s, box-shadow 0.2s;\\n}\\n.awsac-bubble:hover {\\n  transform: scale(1.1);\\n  box-shadow: 0 6px 20px rgba(102,126,234,0.6);\\n}"}',
        b.currentCode ? `\nCurrent custom code:\n${b.currentCode}` : '',
      ].join('\n');

      const chatContext = [
        'You are an expert UI/UX designer and frontend developer specializing in chat widget design.',
        'Your task: Generate production-quality CSS to customize a chat widget INTERFACE.',
        '',
        'TECHNICAL CONTEXT:',
        '- The widget is a floating panel (default 380x520px) with a header, message list, and input.',
        '- It uses a component-scoped CSS system — only target the classes listed below.',
        '',
        'AVAILABLE CSS CLASSES (use only these):',
        '- .awsac-panel — chat panel container (380x520px, border-radius:12px, background:#fff)',
        '- .awsac-header — header bar with title text and close button (background: primaryColor)',
        '- .awsac-messages — scrollable message list area (background:#fafafa)',
        '- .awsac-msg.user .awsac-msg-text — user message text bubbles (right-aligned, blue bg)',
        '- .awsac-msg.assistant .awsac-msg-text — assistant message text bubbles (left-aligned, white bg)',
        '- .awsac-input-wrap — the input area container at bottom',
        '- .awsac-input — the textarea input element',
        '- .awsac-send — the send button',
        '- .awsac-powered — powered-by footer text',
        '- .awsac-welcome — welcome message bubble shown on load',
        '- .awsac-trending — trending questions container',
        '- .awsac-trend-chip — individual trending question chip/button',
        '',
        'QUALITY REQUIREMENTS:',
        '- CSS must be well-formatted with each property on its own line.',
        '- Use modern CSS: gradients, backdrop-filter, border-radius, box-shadow, transitions.',
        '- Maintain readability: ensure sufficient contrast between text and background.',
        '- Include hover/focus states for interactive elements.',
        '- Keep the layout functional — don\'t break scrolling or input.',
        '',
        'OUTPUT FORMAT:',
        'Return ONLY a valid JSON object with one key:',
        '  "css" — CSS rules with proper newlines between declarations',
        'No explanation, no markdown fences, no comments outside JSON.',
        '',
        'EXAMPLE OUTPUT:',
        '{"css":".awsac-panel {\\n  border-radius: 20px;\\n  box-shadow: 0 8px 32px rgba(0,0,0,0.15);\\n}\\n.awsac-header {\\n  background: linear-gradient(135deg, #1a1a2e, #16213e);\\n  padding: 16px;\\n}\\n.awsac-msg.assistant .awsac-msg-text {\\n  background: #f0f4f8;\\n  border-radius: 16px 16px 16px 4px;\\n}"}',
        b.currentCode ? `\nCurrent custom CSS:\n${b.currentCode}` : '',
      ].join('\n');

      const systemPrompt = b.component === 'launcher' ? launcherContext : chatContext;

      try {
        let result: string;
        if (b.image) {
          // Vision-based: use Sonnet for higher fidelity icon/design recreation
          const visionPrompt = b.component === 'launcher'
            ? [
                'Study this image VERY closely. Your job is to recreate this exact visual design as an inline SVG icon inside a chat widget launcher button.',
                '',
                'CRITICAL REQUIREMENTS:',
                '- Recreate every shape, path, and visual element you see in the image as SVG <path> elements.',
                '- Match the exact proportions, curves, and relative positioning of all elements.',
                '- If you see a robot/character face, reproduce its head shape, eyes, mouth, antenna — every detail.',
                '- Use the exact colors from the image. Sample the background color and icon/foreground color precisely.',
                '- The SVG must use viewBox="0 0 24 24" and be detailed enough to look identical at 56x56px.',
                '- Set the .awsac-bubble background to match the circle/button background color in the image.',
                '- Size the bubble to match the image proportions (default 56x56px, increase if needed).',
                '- Add a subtle box-shadow and hover scale effect.',
                '',
                'Return ONLY valid JSON: {"html":"<svg ...>...</svg>","css":".awsac-bubble { ... }"}',
              ].join('\n')
            : [
                'Study this image closely. Recreate the visual design style for a chat widget interface.',
                'Match the colors, typography, spacing, border-radius, shadows, and overall aesthetic as faithfully as possible.',
                'Return ONLY valid JSON: {"css":"..."}',
              ].join('\n');
          result = await bedrockChat.describeImage(b.image, visionPrompt, systemPrompt, 4096, true);
        } else {
          result = await bedrockChat.invokeModel(systemPrompt, b.prompt!);
        }

        // Parse the JSON response, stripping any markdown fences
        const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return ok(parsed);
      } catch (e) {
        console.error('generate-ui error', e);
        return serverError(String(e));
      }
    }

    // POST /assistants/:id/regenerate-key
    if (method === 'POST' && path.endsWith('/regenerate-key')) {
      const item = await ddb.getItem<IAssistant>(TABLE, { id: id! });
      if (!item) return notFound();
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();
      const newKey = `bca_${uuidv4().replace(/-/g, '')}`;
      await ddb.updateItem(TABLE, { id: id! }, { apiKey: newKey, updatedAt: new Date().toISOString() });
      return ok({ apiKey: newKey });
    }

    // --- Knowledge Base linking endpoints ---

    // GET /assistants/:id/knowledge-bases — list linked KBs
    if (method === 'GET' && id && path.includes('/knowledge-bases')) {
      if (!requireRole(ctx, 'viewer')) return forbidden('Insufficient role');
      const item = await ddb.getItem<IAssistant>(TABLE, { id });
      if (!item) return notFound('Assistant not found');
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();

      const links = await ddb.queryItems<IAssistantKbLink>(
        ASSISTANT_KB_TABLE,
        'assistantId = :a', { ':a': id },
        undefined, undefined
      );

      // Enrich with KB definition details
      const enriched = await Promise.all(links.map(async (link) => {
        const kbDef = await ddb.getItem<IKbDefSummary>(KB_DEFS_TABLE, { id: link.knowledgeBaseId });
        return { ...link, knowledgeBase: kbDef ?? null };
      }));

      return ok(enriched);
    }

    // POST /assistants/:id/knowledge-bases — link a KB { knowledgeBaseId }
    if (method === 'POST' && id && path.includes('/knowledge-bases')) {
      if (!requireRole(ctx, 'editor')) return forbidden('Editor role required');
      const item = await ddb.getItem<IAssistant>(TABLE, { id });
      if (!item) return notFound('Assistant not found');
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();

      const b = parseBody<{ knowledgeBaseId: string }>(JSON.stringify(body));
      if (!b?.knowledgeBaseId) return badRequest('knowledgeBaseId is required');

      // Verify KB exists and belongs to same tenant
      const kbDef = await ddb.getItem<IKbDefSummary>(KB_DEFS_TABLE, { id: b.knowledgeBaseId });
      if (!kbDef) return notFound('Knowledge base not found');
      if (kbDef.tenantId !== tenantId) return forbidden();

      const link: IAssistantKbLink = {
        assistantId: id,
        knowledgeBaseId: b.knowledgeBaseId,
        tenantId,
        linkedAt: new Date().toISOString(),
      };
      await ddb.putItem(ASSISTANT_KB_TABLE, link as unknown as Record<string, unknown>);
      return created({ ...link, knowledgeBase: kbDef });
    }

    // DELETE /assistants/:id/knowledge-bases/:kbId — unlink a KB
    if (method === 'DELETE' && id && path.includes('/knowledge-bases/')) {
      if (!requireRole(ctx, 'editor')) return forbidden('Editor role required');
      const item = await ddb.getItem<IAssistant>(TABLE, { id });
      if (!item) return notFound('Assistant not found');
      if (!assertOwnership(item.tenantId, tenantId)) return forbidden();

      // Extract kbId from path: /assistants/:id/knowledge-bases/:kbId
      const segments = path.split('/');
      const kbIdx = segments.indexOf('knowledge-bases');
      const kbId = kbIdx >= 0 ? segments[kbIdx + 1] : '';
      if (!kbId) return badRequest('Knowledge base ID required');

      await ddb.deleteItem(ASSISTANT_KB_TABLE, { assistantId: id, knowledgeBaseId: kbId });
      return noContent();
    }

    return notFound();
  } catch (e) {
    console.error('assistants handler error', e);
    return serverError(String(e));
  }
}
