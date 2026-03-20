/**
 * Amelia REST API Client — connects to Amelia chatbot via REST API.
 *
 * Flow:
 *   1. Auth: POST /api/v1/oauth/token (client_credentials → Bearer token)
 *   2. Connect: POST /api/v1/conversations/connect (creates conversation session)
 *   3. Say: POST /api/v1/conversations/{sessionId}/say?messageText=...
 *   4. Poll: POST /api/v1/conversations/{sessionId}/longpoll (get Amelia's response)
 *   5. Close: POST /api/v1/conversations/{sessionId}/close
 *
 * Used for:
 *   - External bot testing (compare Amelia vs Encompass Assist)
 *   - Live agent transfer (escalation agent → Amelia handoff)
 *   - Amelia conversation analytics
 */

const DEFAULT_BASE_URL = 'https://eyefinity.partners.amelia.com/AmeliaRest';

export interface IAmeliaConfig {
  baseUrl?: string;
  clientId: string;
  clientSecret: string;
  domainCode?: string;
}

export interface IAmeliaSession {
  conversationId: string;
  token: string;
  baseUrl: string;
}

export interface IAmeliaMessage {
  type: string;
  text?: string;
  bmlContent?: string;
  options?: Array<{ label: string; value: string }>;
  raw: unknown;
}

// ── Authentication ────────────────────────────────────────────────────────────

export async function authenticate(config: IAmeliaConfig): Promise<string> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  const res = await fetch(`${baseUrl}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amelia auth failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// ── Conversation Management ───────────────────────────────────────────────────

export async function createConversation(
  token: string,
  config: IAmeliaConfig,
): Promise<IAmeliaSession> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  const res = await fetch(`${baseUrl}/api/v1/conversations/connect`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(config.domainCode && { domainCode: config.domainCode }),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amelia connect failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { conversationId?: string; sessionId?: string };
  const conversationId = data.conversationId ?? data.sessionId ?? '';

  if (!conversationId) {
    throw new Error('No conversationId returned from Amelia connect');
  }

  return { conversationId, token, baseUrl };
}

// ── Send & Receive ────────────────────────────────────────────────────────────

export async function sendMessage(
  session: IAmeliaSession,
  messageText: string,
): Promise<void> {
  const url = `${session.baseUrl}/api/v1/conversations/${session.conversationId}/say?messageText=${encodeURIComponent(messageText)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amelia say failed: ${res.status} ${text}`);
  }
}

export async function pollResponse(
  session: IAmeliaSession,
  useLongPoll: boolean = true,
  maxAttempts: number = 10,
): Promise<IAmeliaMessage[]> {
  const endpoint = useLongPoll ? 'longpoll' : 'poll';
  const messages: IAmeliaMessage[] = [];

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(
      `${session.baseUrl}/api/v1/conversations/${session.conversationId}/${endpoint}`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.token}` },
      },
    );

    if (!res.ok) {
      if (res.status === 410) break; // Session gone
      const text = await res.text();
      throw new Error(`Amelia poll failed: ${res.status} ${text}`);
    }

    const data = await res.json() as any[];

    if (data && data.length > 0) {
      for (const msg of data) {
        messages.push(parseAmeliaMessage(msg));
      }
      // If we got text messages, we're done
      if (messages.some(m => m.text)) break;
    }

    // Short poll: wait before retry
    if (!useLongPoll) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return messages;
}

export async function closeConversation(session: IAmeliaSession): Promise<void> {
  try {
    await fetch(
      `${session.baseUrl}/api/v1/conversations/${session.conversationId}/close`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
  } catch { /* best effort */ }
}

// ── Convenience: Send and get response ────────────────────────────────────────

export async function chat(
  session: IAmeliaSession,
  messageText: string,
): Promise<{ text: string; responseTimeMs: number; allMessages: IAmeliaMessage[] }> {
  const start = Date.now();

  await sendMessage(session, messageText);
  const messages = await pollResponse(session);

  const textMessages = messages.filter(m => m.text);
  const responseText = textMessages.map(m => m.text).join('\n');

  return {
    text: responseText,
    responseTimeMs: Date.now() - start,
    allMessages: messages,
  };
}

// ── Full test flow ────────────────────────────────────────────────────────────

export async function testConversation(
  config: IAmeliaConfig,
  questions: string[],
): Promise<Array<{ question: string; response: string; responseTimeMs: number; error?: string }>> {
  const token = await authenticate(config);
  const session = await createConversation(token, config);
  const results: Array<{ question: string; response: string; responseTimeMs: number; error?: string }> = [];

  // Get welcome message first
  const welcome = await pollResponse(session, true, 3);
  console.log(`[Amelia] Welcome: ${welcome.map(m => m.text).join(' ')}`);

  for (const question of questions) {
    try {
      const result = await chat(session, question);
      results.push({
        question,
        response: result.text,
        responseTimeMs: result.responseTimeMs,
      });
    } catch (err) {
      results.push({
        question,
        response: '',
        responseTimeMs: 0,
        error: String(err),
      });
    }
  }

  await closeConversation(session);
  return results;
}

// ── Message Parser ────────────────────────────────────────────────────────────

function parseAmeliaMessage(raw: any): IAmeliaMessage {
  // Amelia messages can have various types
  const type = raw.type ?? raw.messageType ?? 'unknown';
  let text = '';

  // Extract text from various message formats
  if (raw.text) text = raw.text;
  else if (raw.bmlContent) text = stripBml(raw.bmlContent);
  else if (raw.message) text = raw.message;
  else if (raw.content) text = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content);

  // Extract options/buttons if present
  const options: Array<{ label: string; value: string }> = [];
  if (raw.options) {
    for (const opt of raw.options) {
      options.push({ label: opt.label ?? opt.text ?? '', value: opt.value ?? opt.id ?? '' });
    }
  }

  return { type, text, bmlContent: raw.bmlContent, options: options.length > 0 ? options : undefined, raw };
}

function stripBml(bml: string): string {
  // Strip BML (Business Markup Language) tags to get plain text
  return bml
    .replace(/<[^>]+>/g, '')  // Remove HTML/BML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
