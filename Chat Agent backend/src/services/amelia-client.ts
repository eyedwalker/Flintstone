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
  // Username/password auth (primary)
  username?: string;
  password?: string;
  // OAuth client credentials auth (alternative)
  clientId?: string;
  clientSecret?: string;
  domainCode?: string;
}

export interface IAmeliaSession {
  conversationId: string;
  token: string;
  baseUrl: string;
  authMode: 'token' | 'bearer';
}

export interface IAmeliaMessage {
  type: string;
  text?: string;
  bmlContent?: string;
  options?: Array<{ label: string; value: string }>;
  raw: unknown;
}

// ── Authentication ────────────────────────────────────────────────────────────

export async function authenticate(config: IAmeliaConfig): Promise<{ token: string; authMode: 'token' | 'bearer' }> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  // Method 1: Username/password login (returns X-Amelia-Rest-Token)
  if (config.username && config.password) {
    // Try multiple login endpoints — Amelia versions differ
    const loginUrls = [
      `${baseUrl}/api/v1/auth/login`,
      `${baseUrl}/api/v1/login`,
      `${baseUrl}/api/v1/sessions/login`,
    ];

    // Note: Amelia login endpoint only accepts username/password — NOT domainCode
    const loginBody = { username: config.username, password: config.password };

    let lastError = '';
    for (const loginUrl of loginUrls) {
      try {
        const res = await fetch(loginUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loginBody),
        });

        if (res.status === 404 || res.status === 405) {
          lastError = `${loginUrl}: ${res.status}`;
          continue; // Try next URL
        }

        // Amelia returns 500 for bad credentials (not 401)
        if (res.status === 500) {
          lastError = `${loginUrl}: 500 — check username/password`;
          continue;
        }

        if (!res.ok) {
          const text = await res.text();
          lastError = `${loginUrl}: ${res.status} ${text.slice(0, 200)}`;
          continue;
        }

        const data = await res.json() as any;
        console.log(`[Amelia] Login response keys:`, Object.keys(data));

        // Token could be in various places
        const token = data.token ?? data.sessionToken ?? data.accessToken
          ?? data['X-Amelia-Rest-Token'] ?? data.access_token ?? '';

        if (token) return { token, authMode: 'token' as const };

        // Check response headers
        const headerToken = res.headers.get('X-Amelia-Rest-Token') ?? '';
        if (headerToken) return { token: headerToken, authMode: 'token' as const };

        // If response has an id/sessionId, that might be the token
        if (data.id) return { token: data.id, authMode: 'token' as const };

        console.log(`[Amelia] Full login response:`, JSON.stringify(data).slice(0, 500));
        lastError = `${loginUrl}: No token in response`;
      } catch (err) {
        lastError = `${loginUrl}: ${String(err).slice(0, 200)}`;
        continue;
      }
    }

    throw new Error(`Could not authenticate with Amelia. Last error: ${lastError}`);
  }

  // Method 2: OAuth client credentials (returns Bearer token)
  if (config.clientId && config.clientSecret) {
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
      throw new Error(`Amelia OAuth failed: ${res.status} ${text}`);
    }

    const data = await res.json() as { access_token: string };
    return { token: data.access_token, authMode: 'bearer' };
  }

  throw new Error('Amelia auth requires either username/password or clientId/clientSecret');
}

/** Build the auth header based on auth mode */
function authHeader(token: string, authMode: 'token' | 'bearer'): Record<string, string> {
  if (authMode === 'bearer') {
    return { 'Authorization': `Bearer ${token}` };
  }
  return { 'X-Amelia-Rest-Token': token };
}

// ── Conversation Management ───────────────────────────────────────────────────

export async function createConversation(
  auth: { token: string; authMode: 'token' | 'bearer' },
  config: IAmeliaConfig,
): Promise<IAmeliaSession> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const domain = config.domainCode ?? 'eyefinitysandbox';

  // Only use fields from the NewConversationCommand schema + initialBpnVariables
  // to simulate a real user session (prevents immediate escalation)
  const endpoints = [
    {
      url: `${baseUrl}/api/v1/conversations/new`,
      body: {
        deliveryMode: 'POLLING',
        domain,
        initialBpnVariables: {
          url: '/EPM/',
          company: '936',
          office: '936',
          username: '/Eyefinity/BotTester',
          phone: '0000000000',
          firstname: 'Bot',
          lastname: 'Tester',
        },
        initialAttributes: {},
      },
    },
  ];

  let lastError = '';
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          ...authHeader(auth.token, auth.authMode),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ep.body),
      });

      if (res.status === 404) {
        lastError = `${ep.url}: 404`;
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        lastError = `${ep.url}: ${res.status} ${text.slice(0, 200)}`;
        continue;
      }

      const data = await res.json() as { conversationId?: string; sessionId?: string };
      // Amelia returns both sessionId (UUID) and conversationId (short code).
      // The API endpoints (/say, /poll, /close) require the sessionId (UUID).
      const conversationId = data.sessionId ?? data.conversationId ?? '';

      if (!conversationId) {
        lastError = `${ep.url}: No sessionId in response`;
        continue;
      }

      console.log(`[Amelia] Session created: ${conversationId}`);

      // Some Amelia instances require explicitly starting the conversation
      try {
        await fetch(`${baseUrl}/api/v1/conversations/${conversationId}/start`, {
          method: 'POST',
          headers: {
            ...authHeader(auth.token, auth.authMode),
            'Content-Type': 'application/json',
          },
        });
        console.log(`[Amelia] Conversation started`);
      } catch { /* /start may not be required */ }

      return { conversationId, token: auth.token, baseUrl, authMode: auth.authMode };
    } catch (err) {
      lastError = `${ep.url}: ${String(err).slice(0, 200)}`;
      continue;
    }
  }

  throw new Error(`Amelia connect failed: ${lastError}`);
}

// ── Send & Receive ────────────────────────────────────────────────────────────

export async function sendMessage(
  session: IAmeliaSession,
  messageText: string,
): Promise<void> {
  // Use /send with JSON body (more reliable than /say with query param)
  const url = `${session.baseUrl}/api/v1/conversations/${session.conversationId}/send`;
  console.log(`[Amelia] Sending to ${url}: "${messageText.slice(0, 50)}"`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeader(session.token, session.authMode),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messageText }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[Amelia] Send failed: ${res.status} ${text.slice(0, 200)}`);
    throw new Error(`Amelia send failed: ${res.status} ${text.slice(0, 200)}`);
  }
  console.log(`[Amelia] Send OK`);
}

export async function pollResponse(
  session: IAmeliaSession,
  useLongPoll: boolean = false,
  maxAttempts: number = 10,
): Promise<IAmeliaMessage[]> {
  // Use /longpoll for responses (waits for Amelia to reply), /poll for quick checks
  const endpoint = useLongPoll ? 'longpoll' : 'poll';
  const messages: IAmeliaMessage[] = [];

  console.log(`[Amelia] Polling (${endpoint}) session ${session.conversationId}, max ${maxAttempts} attempts`);

  for (let i = 0; i < maxAttempts; i++) {
    const pollUrl = `${session.baseUrl}/api/v1/conversations/${session.conversationId}/${endpoint}`;
    const res = await fetch(pollUrl, {
      method: 'POST',
      headers: {
        ...authHeader(session.token, session.authMode),
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      if (res.status === 410) { console.log(`[Amelia] Session gone (410)`); break; }
      const text = await res.text();
      console.error(`[Amelia] Poll failed: ${res.status} ${text.slice(0, 200)}`);
      throw new Error(`Amelia poll failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const data = await res.json() as any[];
    console.log(`[Amelia] Poll attempt ${i + 1}: ${data?.length ?? 0} messages`);

    let ameliaReady = false;
    if (data && data.length > 0) {
      for (const msg of data) {
        const msgType = msg.ameliaMessageType ?? msg.messageType ?? '';

        // Skip echo messages (user's own message echoed back)
        if (msg.selfEcho || msgType === 'EchoMessageFromAmelia') {
          console.log(`[Amelia] Skipping echo message`);
          continue;
        }

        // AmeliaReadyMessageFromAmelia = Amelia is done processing
        if (msgType === 'AmeliaReadyMessageFromAmelia') {
          console.log(`[Amelia] Amelia ready — done processing`);
          ameliaReady = true;
          continue;
        }

        // Skip intermediate streaming chunks — only keep FlushBuffered (complete chunk)
        if (msgType === 'StreamingTextMessageFromAmelia') {
          continue;
        }

        messages.push(parseAmeliaMessage(msg));
      }
      // Done when Amelia signals it's ready (finished thinking/processing)
      if (ameliaReady && messages.some(m => m.text)) break;
    }

    // Wait between poll attempts
    await new Promise(r => setTimeout(r, 2000));
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
          ...authHeader(session.token, session.authMode),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ skipPreCloseSurvey: true }),
      },
    );
  } catch { /* best effort */ }
}

// ── Convenience: Send and get response ────────────────────────────────────────

export async function chat(
  session: IAmeliaSession,
  messageText: string,
  useLongPoll: boolean = true,
): Promise<{ text: string; responseTimeMs: number; allMessages: IAmeliaMessage[] }> {
  const start = Date.now();

  await sendMessage(session, messageText);
  // Wait for Amelia to start processing, then poll for response
  await new Promise(r => setTimeout(r, 2000));
  // longpoll: each attempt blocks ~7s, need ~10 attempts for 45s+ Amelia responses
  // short poll: each attempt returns immediately, 2s delay between, need ~8 for ~16s window
  const messages = await pollResponse(session, useLongPoll, useLongPoll ? 10 : 8);

  // Filter out stalling/thinking messages — keep only the substantive answer
  const STALLING_PATTERNS = [
    /^let me (look|check|find|search|get|take)/i,
    /^one moment/i,
    /^just a (moment|second|sec)/i,
    /^hold on/i,
    /^please wait/i,
    /^i('m| am) (looking|checking|searching|working)/i,
    /^looking into/i,
    /^give me a (moment|second)/i,
  ];
  const textMessages = messages.filter(m => m.text);
  const substantive = textMessages.filter(m =>
    !STALLING_PATTERNS.some(p => p.test(m.text!.trim()))
  );
  // Use substantive messages (the real answer), fall back to last message if all were stalling
  const finalMessages = substantive.length > 0 ? substantive : textMessages.slice(-1);
  const responseText = finalMessages.map(m => m.text).join('\n');

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
  const auth = await authenticate(config);
  const session = await createConversation(auth, config);
  const results: Array<{ question: string; response: string; responseTimeMs: number; error?: string }> = [];

  // Get welcome message first
  await new Promise(r => setTimeout(r, 2000));
  const welcome = await pollResponse(session, false, 3);
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

  // Log raw message keys for debugging
  console.log(`[Amelia] Message type=${type}, keys=${Object.keys(raw).join(',')}`);

  // Extract text from various message formats — Amelia uses different fields depending on message type
  if (raw.messageText) text = stripBml(raw.messageText);
  else if (raw.text) text = stripBml(raw.text);
  else if (raw.bml) text = stripBml(raw.bml);
  else if (raw.bmlContent) text = stripBml(raw.bmlContent);
  else if (raw.message) text = stripBml(raw.message);
  else if (raw.content) text = stripBml(typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content));

  if (!text) {
    // For streaming messages, messageText may be empty string — log the full raw for debugging
    const msgType = raw.ameliaMessageType ?? raw.messageType ?? '';
    if (msgType.includes('Streaming') || msgType.includes('FlushBuffered')) {
      // Log ALL non-empty string values to find where streamed text lives
      const nonEmpty = Object.entries(raw).filter(([k, v]) => typeof v === 'string' && v.length > 0 && v.length < 5000).map(([k, v]) => `${k}=${String(v).slice(0, 100)}`);
      console.log(`[Amelia] Streaming fields: ${nonEmpty.join(' | ')}`);
      // Try all possible text fields
      if (raw.speechMessageText) text = raw.speechMessageText;
      else if (raw.messageText) text = raw.messageText;
    } else {
      console.log(`[Amelia] No text extracted. Raw: ${JSON.stringify(raw).slice(0, 300)}`);
    }
  }

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
