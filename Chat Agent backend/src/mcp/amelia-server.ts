#!/usr/bin/env node
/**
 * Amelia MCP Server — Model Context Protocol server for Amelia REST API.
 *
 * Exposes Amelia's chatbot, admin, and analytics APIs as MCP tools.
 * Can be used by Claude Code, test runners, or any MCP client.
 *
 * Usage:
 *   node src/mcp/amelia-server.js
 *
 * Configuration (env vars):
 *   AMELIA_BASE_URL    — Amelia REST API base URL (default: eyefinity.partners.amelia.com)
 *   AMELIA_USERNAME    — Amelia login username
 *   AMELIA_PASSWORD    — Amelia login password
 *   AMELIA_DOMAIN      — Amelia domain code (default: eyefinitysandbox)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = process.env['AMELIA_BASE_URL'] ?? 'https://eyefinity.partners.amelia.com/AmeliaRest';
const DOMAIN = process.env['AMELIA_DOMAIN'] ?? 'eyefinitysandbox';

let authToken: string | null = null;
let activeConversations: Map<string, string> = new Map(); // name → conversationId

// ── Auth Helper ───────────────────────────────────────────────────────────────

async function ensureAuth(): Promise<string> {
  if (authToken) return authToken;

  const username = process.env['AMELIA_USERNAME'];
  const password = process.env['AMELIA_PASSWORD'];
  if (!username || !password) throw new Error('AMELIA_USERNAME and AMELIA_PASSWORD env vars required');

  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) throw new Error(`Amelia auth failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as any;
  authToken = data.token;
  return authToken!;
}

async function ameliaFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = await ensureAuth();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-Amelia-Rest-Token': token,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 410) {
    // Session expired — re-auth and retry
    authToken = null;
    const newToken = await ensureAuth();
    const retry = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'X-Amelia-Rest-Token': newToken,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    if (!retry.ok) throw new Error(`Amelia API failed: ${retry.status} ${await retry.text()}`);
    return retry.json();
  }

  if (!res.ok) throw new Error(`Amelia API failed: ${res.status} ${await res.text()}`);

  const text = await res.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function stripBml(bml: string): string {
  return bml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'amelia', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ── Tool Definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // Auth
    {
      name: 'amelia_login',
      description: 'Authenticate with Amelia and get a session token. Uses AMELIA_USERNAME/AMELIA_PASSWORD env vars.',
      inputSchema: { type: 'object', properties: {} },
    },

    // Conversations
    {
      name: 'amelia_start_conversation',
      description: 'Start a new conversation with Amelia AI chatbot. Returns a conversation ID for subsequent messages.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A friendly name for this conversation (for tracking)' },
          domain: { type: 'string', description: 'Amelia domain code (default: eyefinitysandbox)' },
        },
      },
    },
    {
      name: 'amelia_say',
      description: 'Send a message to Amelia in an active conversation and get the response.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The conversation ID (or name from start_conversation)' },
          message: { type: 'string', description: 'The message to send to Amelia' },
        },
        required: ['message'],
      },
    },
    {
      name: 'amelia_poll',
      description: 'Poll for new messages from Amelia in an active conversation.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The conversation ID' },
          longPoll: { type: 'boolean', description: 'Use long polling (waits for response, default true)' },
        },
      },
    },
    {
      name: 'amelia_close_conversation',
      description: 'Close an active conversation with Amelia.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The conversation ID to close' },
        },
      },
    },
    {
      name: 'amelia_push_to_agent',
      description: 'Transfer an existing conversation to a human agent (live support).',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The conversation to transfer' },
        },
        required: ['conversationId'],
      },
    },

    // Domains
    {
      name: 'amelia_list_domains',
      description: 'List all Amelia domains (organizations/tenants).',
      inputSchema: { type: 'object', properties: {} },
    },

    // Cognitive Agents
    {
      name: 'amelia_list_agents',
      description: 'List cognitive agents configured in Amelia.',
      inputSchema: {
        type: 'object',
        properties: {
          domainId: { type: 'string', description: 'Filter by domain ID' },
        },
      },
    },

    // Analytics
    {
      name: 'amelia_conversation_analytics',
      description: 'Get conversation analytics and performance metrics from Amelia.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Metric type: performance, topic, cognitive-agent, cognitive-function', enum: ['performance', 'topic', 'cognitive-agent', 'cognitive-function'] },
          domainId: { type: 'string', description: 'Domain ID to filter' },
          startDate: { type: 'string', description: 'Start date (ISO format)' },
          endDate: { type: 'string', description: 'End date (ISO format)' },
        },
      },
    },

    // Escalation
    {
      name: 'amelia_list_escalation_queues',
      description: 'List escalation queues for routing conversations to human agents.',
      inputSchema: {
        type: 'object',
        properties: {
          domainId: { type: 'string', description: 'Domain ID' },
        },
      },
    },

    // Topics
    {
      name: 'amelia_get_topic',
      description: 'Get details of an Amelia topic (conversation flow).',
      inputSchema: {
        type: 'object',
        properties: {
          topicId: { type: 'string', description: 'Topic ID' },
        },
        required: ['topicId'],
      },
    },

    // Users
    {
      name: 'amelia_list_users',
      description: 'List users in the Amelia system.',
      inputSchema: {
        type: 'object',
        properties: {
          domainId: { type: 'string', description: 'Domain ID' },
          role: { type: 'string', description: 'Filter by role' },
        },
      },
    },

    // Active conversations (supervisor view)
    {
      name: 'amelia_active_conversations',
      description: 'Get list of currently active conversations (supervisor view).',
      inputSchema: {
        type: 'object',
        properties: {
          domainId: { type: 'string', description: 'Domain ID' },
        },
      },
    },

    // Conversation summary
    {
      name: 'amelia_conversation_summary',
      description: 'Get AI-generated summary of a conversation.',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Conversation ID' },
        },
        required: ['conversationId'],
      },
    },

    // MCP Integrations (meta!)
    {
      name: 'amelia_list_mcp_integrations',
      description: 'List MCP integrations configured in Amelia.',
      inputSchema: {
        type: 'object',
        properties: {
          domainId: { type: 'string', description: 'Domain ID' },
        },
      },
    },
  ],
}));

// ── Tool Handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── Auth ─────────────────────────────────────────────────────────
      case 'amelia_login': {
        const token = await ensureAuth();
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, tokenPrefix: token.slice(0, 8) + '...' }) }] };
      }

      // ── Conversations ────────────────────────────────────────────────
      case 'amelia_start_conversation': {
        const domain = (args as any)?.domain ?? DOMAIN;
        const convName = (args as any)?.name ?? `conv-${Date.now()}`;
        const data = await ameliaFetch('/api/v1/conversations/new', {
          method: 'POST',
          body: JSON.stringify({ deliveryMode: 'POLLING', domain }),
        });
        const convId = data.conversationId ?? data.sessionId ?? '';
        activeConversations.set(convName, convId);

        // Poll for welcome message
        await new Promise(r => setTimeout(r, 2000));
        let welcome = '';
        try {
          const msgs = await ameliaFetch(`/api/v1/conversations/${convId}/poll`, { method: 'POST' });
          if (Array.isArray(msgs)) {
            welcome = msgs
              .map((m: any) => m.text ?? (m.bmlContent ? stripBml(m.bmlContent) : ''))
              .filter(Boolean).join('\n');
          }
        } catch { /* no welcome yet */ }

        return { content: [{ type: 'text', text: JSON.stringify({ conversationId: convId, name: convName, welcome }) }] };
      }

      case 'amelia_say': {
        let convId = (args as any)?.conversationId ?? '';
        const message = (args as any)?.message ?? '';

        // Resolve name to ID
        if (convId && activeConversations.has(convId)) {
          convId = activeConversations.get(convId)!;
        }
        if (!convId && activeConversations.size > 0) {
          convId = [...activeConversations.values()].pop()!;
        }

        // Send
        await ameliaFetch(`/api/v1/conversations/${convId}/say?messageText=${encodeURIComponent(message)}`, {
          method: 'POST',
        });

        // Long poll for response
        await new Promise(r => setTimeout(r, 1000));
        const msgs = await ameliaFetch(`/api/v1/conversations/${convId}/longpoll`, { method: 'POST' });
        let responseText = '';
        if (Array.isArray(msgs)) {
          responseText = msgs
            .map((m: any) => m.text ?? (m.bmlContent ? stripBml(m.bmlContent) : ''))
            .filter(Boolean).join('\n');
        }

        return { content: [{ type: 'text', text: JSON.stringify({ conversationId: convId, message, response: responseText }) }] };
      }

      case 'amelia_poll': {
        let convId = (args as any)?.conversationId ?? [...activeConversations.values()].pop() ?? '';
        if (activeConversations.has(convId)) convId = activeConversations.get(convId)!;
        const useLongPoll = (args as any)?.longPoll !== false;
        const endpoint = useLongPoll ? 'longpoll' : 'poll';

        const msgs = await ameliaFetch(`/api/v1/conversations/${convId}/${endpoint}`, { method: 'POST' });
        let texts: string[] = [];
        if (Array.isArray(msgs)) {
          texts = msgs.map((m: any) => m.text ?? (m.bmlContent ? stripBml(m.bmlContent) : '')).filter(Boolean);
        }

        return { content: [{ type: 'text', text: JSON.stringify({ conversationId: convId, messages: texts }) }] };
      }

      case 'amelia_close_conversation': {
        let convId = (args as any)?.conversationId ?? '';
        if (activeConversations.has(convId)) {
          convId = activeConversations.get(convId)!;
          activeConversations.delete((args as any)?.conversationId);
        }
        await ameliaFetch(`/api/v1/conversations/${convId}/close`, {
          method: 'POST', body: JSON.stringify({}),
        });
        return { content: [{ type: 'text', text: JSON.stringify({ closed: true, conversationId: convId }) }] };
      }

      case 'amelia_push_to_agent': {
        const convId = (args as any)?.conversationId ?? '';
        const data = await ameliaFetch(`/api/v1/conversations/${convId}/push-to-agent`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // ── Domains ──────────────────────────────────────────────────────
      case 'amelia_list_domains': {
        const data = await ameliaFetch('/api/v1/admin/domains/');
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // ── Cognitive Agents ─────────────────────────────────────────────
      case 'amelia_list_agents': {
        const domainId = (args as any)?.domainId ? `?domainId=${(args as any).domainId}` : '';
        const data = await ameliaFetch(`/api/v1/admin/agentic/agents${domainId}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // ── Analytics ────────────────────────────────────────────────────
      case 'amelia_conversation_analytics': {
        const type = (args as any)?.type ?? 'performance';
        const params = new URLSearchParams();
        if ((args as any)?.domainId) params.set('domainId', (args as any).domainId);
        if ((args as any)?.startDate) params.set('startDate', (args as any).startDate);
        if ((args as any)?.endDate) params.set('endDate', (args as any).endDate);
        const query = params.toString() ? `?${params.toString()}` : '';
        const data = await ameliaFetch(`/api/v1/admin/analytics/conversation/${type}${query}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // ── Escalation Queues ────────────────────────────────────────────
      case 'amelia_list_escalation_queues': {
        const domainId = (args as any)?.domainId ? `?domainId=${(args as any).domainId}` : '';
        const data = await ameliaFetch(`/api/v1/admin/escalationQueues/${domainId}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // ── Topics ───────────────────────────────────────────────────────
      case 'amelia_get_topic': {
        const topicId = (args as any)?.topicId ?? '';
        const data = await ameliaFetch(`/api/v1/admin/agentic/topics/${topicId}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // ── Users ────────────────────────────────────────────────────────
      case 'amelia_list_users': {
        const params = new URLSearchParams();
        if ((args as any)?.domainId) params.set('domainId', (args as any).domainId);
        if ((args as any)?.role) params.set('role', (args as any).role);
        const query = params.toString() ? `?${params.toString()}` : '';
        const data = await ameliaFetch(`/api/v1/admin/users/${query}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // ── Active Conversations ─────────────────────────────────────────
      case 'amelia_active_conversations': {
        const domainId = (args as any)?.domainId ? `?domainId=${(args as any).domainId}` : '';
        const data = await ameliaFetch(`/api/v1/admin/conversations/active${domainId}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // ── Conversation Summary ─────────────────────────────────────────
      case 'amelia_conversation_summary': {
        const convId = (args as any)?.conversationId ?? '';
        const data = await ameliaFetch(`/api/v1/admin/analytics/conversation/${convId}/summary`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      // ── MCP Integrations ─────────────────────────────────────────────
      case 'amelia_list_mcp_integrations': {
        const domainId = (args as any)?.domainId ? `?domainId=${(args as any).domainId}` : '';
        const data = await ameliaFetch(`/api/v1/admin/agentic/mcp-integrations${domainId}`);
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true };
  }
});

// ── Start Server ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Amelia MCP Server running on stdio');
}

main().catch(console.error);
