/**
 * Voice & SMS Webhook Routes — handles Twilio callbacks for multi-turn conversations.
 *
 * Endpoints (no JWT auth — Twilio signature validated instead):
 *   POST /voice/inbound     — incoming call, return greeting TwiML
 *   POST /voice/respond     — speech captured, process and return next TwiML
 *   GET  /voice/outbound-twiml — TwiML for outbound calls
 *   POST /voice/sms-inbound — incoming SMS, process and reply
 *   POST /voice/status      — call status callback (recording, completion)
 *
 * Service-token endpoints (Bearer auth, used by the Nova Sonic voice bridge):
 *   GET  /voice/tool-schemas — list voice-safe tool schemas
 *   POST /voice/tool-execute — execute a single tool call
 *
 * Authenticated endpoint:
 *   POST /voice/outbound    — initiate an outbound call (admin/editor only)
 */

import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as conversationEngine from '../services/conversation-engine';
import * as twiml from '../services/voice-twiml';
import * as integrations from '../services/integrations';
import * as smsOptOut from '../services/sms-opt-out';
import * as toolRegistry from '../services/voice-tool-registry';
import * as callLog from '../services/voice-call-log';
import * as callAnalyzer from '../services/voice-call-analyzer';
import * as transcription from '../services/voice-transcription';
import * as metrics from '../services/metrics';
import * as smsIntent from '../services/sms-intent';
import * as smsEmergency from '../services/sms-emergency';
import { parseBody } from '../auth';

const METRICS_NAMESPACE = 'VoiceBackend';

const DEFAULT_TENANT_ID = process.env['DEFAULT_VOICE_TENANT_ID'] ?? '58b19370-10a1-70b9-584d-f14f731f6963';
const DEFAULT_AGENT_NAME = 'Emily';

/**
 * Returns true when the inbound `To` number is opted in to the Nova Sonic
 * streaming bridge. Configured via NOVA_SONIC_ENABLED_NUMBERS (comma-separated
 * E.164 list) — leave it empty to disable streaming entirely.
 *
 * Match is exact after stripping whitespace; no prefix matching, so adding
 * a single number can't accidentally migrate a whole range.
 */
function isStreamingNumber(toPhone: string): boolean {
  const list = process.env['NOVA_SONIC_ENABLED_NUMBERS'];
  if (!list || !toPhone) return false;
  const target = toPhone.trim();
  return list.split(',').some((n) => n.trim() === target);
}

function twimlResponse(xml: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: xml,
  };
}

function jsonResponse(data: unknown, statusCode = 200): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data),
  };
}

function smsTwimlMessage(message: string): APIGatewayProxyResultV2 {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return twimlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
  );
}

// ── Inbound Call ──────────────────────────────────────────────────────────────

/**
 * POST /voice/inbound — Twilio "A Call Comes In" webhook.
 * Creates a session and returns a greeting with Gather.
 */
export async function handleInboundCall(
  body: Record<string, string>,
  baseUrl: string,
): Promise<APIGatewayProxyResultV2> {
  const callSid = body['CallSid'] ?? uuidv4();
  const fromPhone = body['From'] ?? '';
  const toPhone = body['To'] ?? '';

  console.log(`[Voice] Inbound call: ${fromPhone} → ${toPhone} (${callSid})`);

  // Nova Sonic streaming bridge — migrated numbers only.
  // Bridge owns the entire call from here; no session is created in DDB
  // since the bridge maintains its own state for the call duration.
  if (isStreamingNumber(toPhone)) {
    const streamUrl = process.env['NOVA_SONIC_STREAM_URL'];
    if (streamUrl) {
      console.log(`[Voice] Routing ${toPhone} to Nova Sonic stream (${callSid})`);
      return twimlResponse(twiml.buildStreamTwiml(streamUrl, DEFAULT_TENANT_ID, fromPhone));
    }
    console.warn(`[Voice] ${toPhone} is in NOVA_SONIC_ENABLED_NUMBERS but NOVA_SONIC_STREAM_URL is unset; falling back to Say/Gather`);
  }

  // Create session with patient lookup
  const session = await conversationEngine.createSession(
    callSid,
    DEFAULT_TENANT_ID,
    'voice',
    fromPhone,
    DEFAULT_AGENT_NAME,
  );

  // Build greeting
  const timeGreeting = twiml.getTimeGreeting();
  const patientName = session.patient ? `, ${session.patient.firstName}` : '';
  const greeting = `${timeGreeting}${patientName}! Thank you for calling. This is ${session.agentName}. How can I help you today?`;

  // Add greeting to history
  session.history.push({
    role: 'assistant',
    content: greeting,
    timestamp: new Date().toISOString(),
  });
  await conversationEngine.saveSession(session);

  const callbackUrl = `${baseUrl}/voice/respond`;
  return twimlResponse(twiml.buildGreetingTwiml(greeting, callbackUrl));
}

// ── Conversation Turn ─────────────────────────────────────────────────────────

/**
 * POST /voice/respond — Twilio Gather callback.
 * Processes speech input and returns next TwiML.
 */
export async function handleVoiceRespond(
  body: Record<string, string>,
  baseUrl: string,
): Promise<APIGatewayProxyResultV2> {
  const callSid = body['CallSid'] ?? '';
  const speechResult = body['SpeechResult'] ?? '';
  const digits = body['Digits'] ?? '';
  const fromPhone = body['From'] ?? '';

  console.log(`[Voice] Turn: "${speechResult || digits}" (${callSid})`);

  // Handle DTMF: 0 = transfer
  if (digits === '0') {
    const officePhone = await integrations.getOfficePhone(DEFAULT_TENANT_ID);
    return twimlResponse(twiml.buildTransferTwiml(
      'Let me connect you with a team member. One moment please.',
      officePhone,
      { voicemailCallbackUrl: `${baseUrl}/voice/recording-status?type=voicemail` },
    ));
  }

  const userInput = speechResult || digits || '[no speech detected]';

  const result = await conversationEngine.processMessage(
    callSid,
    userInput,
    DEFAULT_TENANT_ID,
    'voice',
    fromPhone,
    DEFAULT_AGENT_NAME,
  );

  // Handle outcomes
  if (result.shouldEndCall) {
    return twimlResponse(twiml.buildHangupTwiml(result.response));
  }

  if (result.shouldTransfer) {
    const officePhone = await integrations.getOfficePhone(DEFAULT_TENANT_ID);
    return twimlResponse(twiml.buildTransferTwiml(
      result.response,
      officePhone,
      { voicemailCallbackUrl: `${baseUrl}/voice/recording-status?type=voicemail` },
    ));
  }

  const callbackUrl = `${baseUrl}/voice/respond`;
  return twimlResponse(twiml.buildGatherTwiml(result.response, callbackUrl));
}

// ── Outbound Call TwiML ───────────────────────────────────────────────────────

/**
 * GET /voice/outbound-twiml — TwiML for outbound calls.
 * Twilio fetches this URL when the outbound call connects.
 */
export async function handleOutboundTwiml(
  query: Record<string, string>,
  baseUrl: string,
): Promise<APIGatewayProxyResultV2> {
  const message = query['message'] ?? 'Hello, this is a call from your eye care office.';
  const callSid = query['callSid'] ?? uuidv4();

  // Create session for the outbound call
  const toPhone = query['to'] ?? '';
  await conversationEngine.createSession(
    callSid,
    DEFAULT_TENANT_ID,
    'voice',
    toPhone,
    DEFAULT_AGENT_NAME,
  );

  const callbackUrl = `${baseUrl}/voice/respond`;
  return twimlResponse(twiml.buildGreetingTwiml(message, callbackUrl));
}

// ── Outbound Call Initiation ──────────────────────────────────────────────────

/**
 * POST /voice/outbound — Initiate an outbound call (authenticated).
 */
export async function handleOutboundCall(
  body: Record<string, unknown>,
): Promise<APIGatewayProxyResultV2> {
  const b = parseBody<{
    to: string;
    message?: string;
    voiceName?: string;
    /** Set true to route through the Nova Sonic streaming bridge for a conversational call. */
    useStreaming?: boolean;
    /** When streaming, the goal/context the model should pursue (e.g. "confirm Tuesday 2pm appointment"). */
    goal?: string;
  }>(JSON.stringify(body));

  if (!b?.to) {
    return jsonResponse({ error: 'to is required' }, 400);
  }

  if (b.useStreaming) {
    const streamUrl = process.env['NOVA_SONIC_STREAM_URL'];
    if (!streamUrl) {
      return jsonResponse({ error: 'NOVA_SONIC_STREAM_URL is not configured' }, 503);
    }
    const streamTwiml = twiml.buildStreamTwiml(streamUrl, DEFAULT_TENANT_ID, b.to, {
      direction: 'outbound',
      goal: b.goal,
    });
    const result = await integrations.makeCall(DEFAULT_TENANT_ID, b.to, '', { twiml: streamTwiml });
    return jsonResponse(result);
  }

  if (!b.message) {
    return jsonResponse({ error: 'message is required for non-streaming calls' }, 400);
  }
  const result = await integrations.makeCall(DEFAULT_TENANT_ID, b.to, b.message, b.voiceName);
  return jsonResponse(result);
}

// ── SMS Inbound ───────────────────────────────────────────────────────────────

/**
 * POST /voice/sms-inbound — Twilio SMS webhook.
 * Processes incoming SMS and replies using the same conversation engine.
 */
export async function handleSmsInbound(
  body: Record<string, string>,
): Promise<APIGatewayProxyResultV2> {
  const fromPhone = body['From'] ?? '';
  const toPhone = body['To'] ?? '';
  const messageBody = body['Body'] ?? '';
  const messageSid = body['MessageSid'] ?? '';

  console.log(`[SMS] Inbound: "${messageBody}" from ${fromPhone} (${messageSid})`);

  if (!messageBody.trim()) {
    return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }

  // TCPA: STOP/START/HELP keywords short-circuit the LLM path entirely.
  // No intent classification, no logging — the carrier-level opt-out flow
  // requires our response to be immediate and predictable.
  const keyword = smsOptOut.classifyKeyword(messageBody);
  if (keyword === 'STOP') {
    await smsOptOut.setOptOut(DEFAULT_TENANT_ID, fromPhone);
    console.log(`[SMS] Opt-out recorded for ${fromPhone}`);
    return smsTwimlMessage(smsOptOut.STOP_REPLY);
  }
  if (keyword === 'START') {
    await smsOptOut.clearOptOut(DEFAULT_TENANT_ID, fromPhone);
    console.log(`[SMS] Opt-in restored for ${fromPhone}`);
    return smsTwimlMessage(smsOptOut.START_REPLY);
  }
  if (keyword === 'HELP') {
    return smsTwimlMessage(smsOptOut.HELP_REPLY);
  }

  // SMS sessions are keyed by phone number (persistent across messages).
  const sessionId = `sms-${fromPhone.replace(/\D/g, '')}`;
  // Use messageSid as the call-log id so each inbound SMS gets its own
  // record. Conversation continuity lives in conversationEngine's session
  // (keyed by phone); the call-log entries are per-message for analytics.
  const logId = messageSid || `sms-${fromPhone}-${Date.now()}`;

  // Classify intent in parallel with starting the call-log entry. The
  // emergency branch needs the classification synchronously; everything
  // else just uses it for logging + metrics.
  const [intent] = await Promise.all([
    smsIntent.classify(messageBody),
    callLog.startCall({
      callSid: logId,
      tenantId: DEFAULT_TENANT_ID,
      direction: 'inbound',
      fromPhone,
      toPhone,
    }).catch((err: unknown) => console.warn('[SMS] call-log startCall failed:', err)),
  ]);

  await callLog.appendEvent(logId, {
    type: 'sms_received',
    at: new Date().toISOString(),
    data: { messageBody, intent: intent.intent, urgency: intent.urgency, confidence: intent.confidence },
  });

  metrics.emit({
    namespace: METRICS_NAMESPACE,
    dimensions: { TenantId: DEFAULT_TENANT_ID, Intent: intent.intent, Urgency: intent.urgency },
    values: { SmsReceived: 1, SmsConfidence: intent.confidence },
    units: { SmsConfidence: 'None' },
  });

  // Emergency: skip the conversation engine entirely. The patient gets a
  // safe-harbor reply, staff gets paged. We never let the LLM "solve" an
  // emergency over SMS — too much risk of bad advice or prompt injection.
  if (intent.isEmergency) {
    console.warn(`[SMS] EMERGENCY detected from ${fromPhone}: ${intent.reasoning ?? '(no reasoning)'}`);
    const escalation = await smsEmergency.escalate({
      tenantId: DEFAULT_TENANT_ID,
      patientPhone: fromPhone,
      messageBody,
      intent,
    });
    await callLog.appendEvent(logId, {
      type: 'sms_emergency_escalated',
      at: new Date().toISOString(),
      data: {
        patientNotified: escalation.patientNotified,
        staffNotified: escalation.staffNotified,
        errors: escalation.errors,
      },
    });
    await callLog.endCall(logId);
    metrics.emit({
      namespace: METRICS_NAMESPACE,
      dimensions: { TenantId: DEFAULT_TENANT_ID },
      values: {
        SmsEmergency: 1,
        SmsEmergencyPatientNotified: escalation.patientNotified ? 1 : 0,
        SmsEmergencyStaffNotified: escalation.staffNotified ? 1 : 0,
      },
    });
    // Empty Response — escalate() already sent our reply via sendSms so
    // we don't reply twice via TwiML.
    return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }

  // Non-emergency path: run through the conversation engine as before.
  const result = await conversationEngine.processMessage(
    sessionId,
    messageBody,
    DEFAULT_TENANT_ID,
    'sms',
    fromPhone,
    DEFAULT_AGENT_NAME,
  );

  await callLog.appendEvent(logId, {
    type: 'sms_replied',
    at: new Date().toISOString(),
    data: { responseLength: result.response.length, shouldEscalate: result.shouldTransfer },
  });
  await callLog.endCall(logId);

  return smsTwimlMessage(result.response);
}

// ── Call Status Callback ──────────────────────────────────────────────────────

/**
 * POST /voice/status — Twilio call status webhook.
 */
export async function handleCallStatus(
  body: Record<string, string>,
): Promise<APIGatewayProxyResultV2> {
  const callSid = body['CallSid'] ?? '';
  const status = body['CallStatus'] ?? '';
  const duration = body['CallDuration'] ?? '';

  console.log(`[Voice] Status: ${callSid} → ${status} (${duration}s)`);

  // Mark session as ended if call is complete
  if (['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(status)) {
    const session = await conversationEngine.loadSession(callSid);
    if (session && !session.endedAt) {
      session.endedAt = new Date().toISOString();
      await conversationEngine.saveSession(session);
    }
  }

  return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>');
}

// ── Voice Bridge Service-Token Endpoints ──────────────────────────────────────

/**
 * Constant-time bearer-token check against VOICE_GATEWAY_SERVICE_TOKEN.
 * Returns true if the header matches a configured token, false otherwise.
 * If the env var is unset, all calls are rejected — the bridge must be
 * provisioned explicitly to enable these endpoints.
 */
function isAuthorizedBridge(headers: Record<string, string | undefined>): boolean {
  const configured = process.env['VOICE_GATEWAY_SERVICE_TOKEN'];
  if (!configured) return false;
  const auth = headers['authorization'] ?? headers['Authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const presented = auth.slice(7);
  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * GET /voice/tool-schemas — return the voice-safe tool schemas.
 * Called by the Nova Sonic bridge at session start to populate the model's
 * tool surface.
 */
export async function handleToolSchemas(
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  if (!isAuthorizedBridge(headers)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  return jsonResponse({ tools: toolRegistry.listSchemas() });
}

/**
 * POST /voice/tool-execute — execute a single tool call.
 * The bridge calls this when Nova Sonic emits a tool_use event during a call.
 * Body: { tool, input, context: { tenantId, callerPhone?, callerPatientId? } }
 */
export async function handleToolExecute(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  if (!isAuthorizedBridge(headers)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const tool = body['tool'];
  const input = body['input'];
  const context = body['context'];

  if (typeof tool !== 'string' || !tool) {
    return jsonResponse({ error: 'tool is required' }, 400);
  }
  if (input !== undefined && (typeof input !== 'object' || input === null)) {
    return jsonResponse({ error: 'input must be an object' }, 400);
  }
  if (typeof context !== 'object' || context === null) {
    return jsonResponse({ error: 'context is required' }, 400);
  }
  const ctx = context as Record<string, unknown>;
  const tenantId = ctx['tenantId'];
  if (typeof tenantId !== 'string' || !tenantId) {
    return jsonResponse({ error: 'context.tenantId is required' }, 400);
  }

  const toolStart = Date.now();
  const result = await toolRegistry.execute(
    tool,
    (input as Record<string, unknown>) ?? {},
    {
      tenantId,
      callerPhone: typeof ctx['callerPhone'] === 'string' ? ctx['callerPhone'] : undefined,
      callerPatientId: typeof ctx['callerPatientId'] === 'string' ? ctx['callerPatientId'] : undefined,
      callSid: typeof ctx['callSid'] === 'string' ? ctx['callSid'] : undefined,
    },
  );

  metrics.emit({
    namespace: METRICS_NAMESPACE,
    dimensions: { TenantId: tenantId, ToolName: tool, Outcome: result.success ? 'success' : (result.errorCode ?? 'failed') },
    values: { ToolExecuted: 1, ToolLatencyMs: Date.now() - toolStart },
    units: { ToolLatencyMs: 'Milliseconds' },
  });

  // Status code policy:
  //   success → 200
  //   TOOL_NOT_ALLOWED (denylist / unknown) → 403 (caller must not retry)
  //   CALLER_SCOPE_VIOLATION → 200 with success:false (model can recover by re-prompting)
  //   TOOL_FAILED (downstream error) → 200 with success:false (model can apologize)
  const status = result.errorCode === 'TOOL_NOT_ALLOWED' ? 403 : 200;
  return jsonResponse(result, status);
}

// ── Call Log / Observability ──────────────────────────────────────────────────

/**
 * POST /voice/call-event — bridge posts lifecycle events for monitoring.
 * Body: { callSid, type, data?, tenantId, fromPhone?, toPhone?, direction?, start? }
 *
 * When `start: true`, creates the call log record; otherwise appends an event.
 * When `type === 'end'`, marks the call ended (sets endedAt + TTL).
 */
export async function handleCallEvent(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  if (!isAuthorizedBridge(headers)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const callSid = body['callSid'];
  const type = body['type'];
  if (typeof callSid !== 'string' || !callSid) {
    return jsonResponse({ error: 'callSid is required' }, 400);
  }
  if (typeof type !== 'string' || !type) {
    return jsonResponse({ error: 'type is required' }, 400);
  }

  try {
    if (body['start'] === true) {
      const tenantId = typeof body['tenantId'] === 'string' ? body['tenantId'] : DEFAULT_TENANT_ID;
      const direction = body['direction'] === 'outbound' ? 'outbound' : 'inbound';
      await callLog.startCall({
        callSid,
        tenantId,
        direction,
        fromPhone: typeof body['fromPhone'] === 'string' ? body['fromPhone'] : undefined,
        toPhone: typeof body['toPhone'] === 'string' ? body['toPhone'] : undefined,
      });
    }

    await callLog.appendEvent(callSid, {
      type,
      at: new Date().toISOString(),
      data: (body['data'] && typeof body['data'] === 'object') ? body['data'] as Record<string, unknown> : undefined,
    });

    if (typeof body['patientId'] === 'string') {
      await callLog.setPatientId(callSid, body['patientId']);
    }

    if (type === 'end') {
      await callLog.endCall(callSid);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('[Voice] call-event failed:', err);
    return jsonResponse({ success: false, error: String(err) }, 500);
  }
}

/**
 * GET /voice/active-calls — list calls in progress for the caller's tenant.
 * Admin/editor only via the standard JWT (handled by the router).
 */
export async function handleActiveCalls(
  tenantId: string,
): Promise<APIGatewayProxyResultV2> {
  if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, 400);
  const calls = await callLog.listActiveCalls(tenantId);
  return jsonResponse({ calls });
}

/**
 * GET /voice/call/{callSid} — full call detail (events, recording URL).
 */
export async function handleCallDetail(
  callSid: string,
  tenantId: string,
): Promise<APIGatewayProxyResultV2> {
  if (!callSid) return jsonResponse({ error: 'callSid is required' }, 400);
  const call = await callLog.getCall(callSid);
  if (!call) return jsonResponse({ error: 'Not found' }, 404);
  if (call.tenantId !== tenantId) return jsonResponse({ error: 'Not found' }, 404);
  return jsonResponse({ call });
}

/**
 * Send a brief SMS to the office phone announcing a new voicemail. We
 * deliberately keep the message short and don't include the audio URL — the
 * URL requires Twilio Basic Auth to download, which staff won't have on a
 * phone. The dashboard / call detail endpoint is the right place to listen.
 */
async function notifyStaffOfVoicemail(
  tenantId: string,
  callSid: string,
  fromPhone: string | undefined,
  durationStr: string,
): Promise<void> {
  const officePhone = await integrations.getOfficePhone(tenantId);
  if (!officePhone) {
    console.warn(`[Voicemail] no office phone for tenant ${tenantId}; skipping notification`);
    return;
  }
  const from = fromPhone ?? 'unknown number';
  const duration = durationStr ? `${durationStr}s` : 'unknown duration';
  const message = `New voicemail from ${from} (${duration}). Call ID ${callSid}. Listen in the dashboard.`;
  const result = await integrations.sendSms(tenantId, officePhone, message);
  if (!result.success) {
    console.warn(`[Voicemail] SMS notify failed: ${result.error}`);
  }
}

/**
 * POST /voice/recording-status — Twilio recording status webhook.
 * Twilio POSTs here when a recording is started/in-progress/completed.
 *
 * Branches on query param `?type=voicemail` (set on the <Record> element's
 * recordingStatusCallback URL by buildTransferTwiml / redirectCallToOffice):
 *   • voicemail → records voicemail_recorded event, SMS notifies the office,
 *                 then still runs the standard transcription + analysis
 *   • absent    → full-call recording flow (same transcription + analysis)
 */
export async function handleRecordingStatus(
  body: Record<string, string>,
  query: Record<string, string> = {},
): Promise<APIGatewayProxyResultV2> {
  const callSid = body['CallSid'] ?? '';
  const recordingSid = body['RecordingSid'] ?? '';
  const status = body['RecordingStatus'] ?? '';
  const url = body['RecordingUrl'] ?? '';
  const durationStr = body['RecordingDuration'] ?? '';
  const isVoicemail = query['type'] === 'voicemail';
  const recordingKind = isVoicemail ? 'voicemail' : 'full-call';

  console.log(`[Recording:${recordingKind}] ${status} callSid=${callSid} recordingSid=${recordingSid} duration=${durationStr}`);

  if (status !== 'completed' || !callSid || !url) {
    // Acknowledge but don't write incomplete recordings
    return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  }

  try {
    const duration = durationStr ? Number(durationStr) : undefined;
    await callLog.setRecording(callSid, url, Number.isFinite(duration) ? duration : undefined);
    await callLog.appendEvent(callSid, {
      type: isVoicemail ? 'voicemail_recorded' : 'recording_complete',
      at: new Date().toISOString(),
      data: { recordingSid, url, duration: durationStr, kind: recordingKind },
    });

    // Look up the tenant from the call record (recording webhook only has
    // CallSid; tenantId was captured when the stream started).
    const call = await callLog.getCall(callSid);
    const tenantId = call?.tenantId;

    metrics.emit({
      namespace: METRICS_NAMESPACE,
      dimensions: { TenantId: tenantId ?? 'unknown', Direction: call?.direction ?? 'inbound', Kind: recordingKind },
      values: {
        RecordingCompleted: 1,
        RecordingDurationS: Number.isFinite(duration) ? (duration as number) : 0,
        [isVoicemail ? 'VoicemailRecorded' : 'CallRecorded']: 1,
      },
      units: { RecordingDurationS: 'Seconds' },
    });

    // Voicemail-specific notification: SMS the office phone so staff know
    // there's a message to listen to. The standard transcription + analyzer
    // pipeline still runs below, so the transcript + summary land on the
    // same call record minutes later.
    if (isVoicemail && tenantId) {
      void notifyStaffOfVoicemail(tenantId, callSid, call?.fromPhone, durationStr).catch((err: unknown) => {
        console.error(`[Voicemail] staff notification failed for ${callSid}:`, err);
      });
    }

    // Two parallel fire-and-forgets:
    //  1. Event-log analysis runs now so staff have *something* fast
    //  2. Audio transcription kicks off; when it lands, transcript-ready
    //     re-runs the analyzer with the full transcript folded in
    void callAnalyzer.analyzeCall(callSid).catch((err) => {
      console.error(`[Analyzer] event-log analysis failed for ${callSid}:`, err);
    });
    if (tenantId) {
      void transcription.kickoffTranscription(callSid, tenantId, url).then((r) => {
        if (!r.success) console.warn(`[Transcription] kickoff failed for ${callSid}: ${r.error}`);
      });
    } else {
      console.warn(`[Recording] no tenant found for ${callSid}; skipping transcription`);
    }
  } catch (err) {
    console.error('[Recording] setRecording failed:', err);
  }

  return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>');
}

/**
 * POST /voice/transcript-ready — invoked when an Amazon Transcribe job lands.
 * Wiring: an EventBridge rule on "Transcribe Job State Change" (COMPLETED)
 * triggers a thin Lambda that POSTs `{ callSid, s3Key }` here (with the bridge
 * bearer). Body may also carry a literal `transcriptText` for manual delivery.
 */
export async function handleTranscriptReady(
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>,
): Promise<APIGatewayProxyResultV2> {
  if (!isAuthorizedBridge(headers)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  const callSid = body['callSid'];
  if (typeof callSid !== 'string' || !callSid) {
    return jsonResponse({ error: 'callSid is required' }, 400);
  }
  const s3Key = typeof body['s3Key'] === 'string' ? body['s3Key'] : undefined;
  const transcriptText = typeof body['transcriptText'] === 'string' ? body['transcriptText'] : undefined;
  if (!s3Key && !transcriptText) {
    return jsonResponse({ error: 's3Key or transcriptText is required' }, 400);
  }
  const result = await transcription.applyTranscript({ callSid, s3Key, transcriptText });
  return jsonResponse(result, result.success ? 200 : 500);
}

/**
 * POST /voice/call/{callSid}/reanalyze — admin re-runs analysis for a call.
 * Useful after tweaking the analyzer prompt or fixing event-log gaps.
 */
export async function handleReanalyzeCall(
  callSid: string,
  tenantId: string,
): Promise<APIGatewayProxyResultV2> {
  const call = await callLog.getCall(callSid);
  if (!call || call.tenantId !== tenantId) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  const analysis = await callAnalyzer.analyzeCall(callSid);
  if (!analysis) return jsonResponse({ error: 'Analysis failed; see logs' }, 502);
  return jsonResponse({ analysis });
}
