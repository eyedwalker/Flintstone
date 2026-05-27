/**
 * Tool Bridge — HTTP client for the Chat Agent backend's voice-tool endpoints.
 *
 * When Nova Sonic emits a tool_use event during a call, the bridge POSTs to
 * /voice/tool-execute and feeds the result back to Nova as a tool_result.
 *
 * Schemas are fetched once per process start (or per session, depending on
 * caching strategy) and passed to Nova as the model's tool surface.
 */

export interface IToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface IToolExecuteRequest {
  tool: string;
  input: Record<string, unknown>;
  context: {
    tenantId: string;
    callerPhone?: string;
    callerPatientId?: string;
    /** Twilio CallSid — required for transferToHuman and similar live-call tools. */
    callSid?: string;
  };
}

export interface IToolExecuteResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  errorCode?: string;
}

const BACKEND_URL = process.env['CHAT_AGENT_BACKEND_URL'] ?? '';
const SERVICE_TOKEN = process.env['VOICE_GATEWAY_SERVICE_TOKEN'] ?? '';

if (!BACKEND_URL) console.warn('[ToolBridge] CHAT_AGENT_BACKEND_URL is not set');
if (!SERVICE_TOKEN) console.warn('[ToolBridge] VOICE_GATEWAY_SERVICE_TOKEN is not set');

export async function fetchSchemas(): Promise<IToolSchema[]> {
  const res = await fetch(`${BACKEND_URL}/voice/tool-schemas`, {
    headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`fetchSchemas failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json() as { tools: IToolSchema[] };
  return data.tools;
}

export async function executeTool(req: IToolExecuteRequest): Promise<IToolExecuteResponse> {
  const res = await fetch(`${BACKEND_URL}/voice/tool-execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_TOKEN}`,
    },
    body: JSON.stringify(req),
  });
  // Backend returns 200 with success:false for recoverable errors,
  // 403 for denied tools, 400 for bad requests. All return a body.
  const body = await res.json() as IToolExecuteResponse;
  return body;
}
