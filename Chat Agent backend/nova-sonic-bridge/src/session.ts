/**
 * Session orchestrator — connects a single Twilio Media Streams WebSocket to
 * a single Bedrock Nova Sonic 2 bidirectional stream and routes events both ways.
 *
 *   Twilio (8kHz μ-law) ──→ audio.mulaw8kToPcm16k ──→ Nova Sonic (16kHz PCM)
 *   Twilio (8kHz μ-law) ←── audio.pcm16kToMulaw8k ←── Nova Sonic (16kHz PCM)
 *
 *   Nova tool_use → tool-bridge.executeTool → Nova toolResult
 *
 * Also enforces the 8-minute Nova Sonic session cap (gracefully wraps up at 7:50).
 */

import { TwilioStreamConnection, ITwilioStartEvent } from './twilio-stream';
import { NovaSonicSession, SonicEvent } from './nova-sonic-client';
import { mulaw8kToPcm16k, pcm16kToMulaw8k } from './audio';
import { fetchSchemas, executeTool } from './tool-bridge';
import { buildSystemPrompt, IResolvedPatient } from './prompt';
import * as eventLog from './event-log';
import * as metrics from './metrics';
import { startRecording } from './twilio-rest';
import type WebSocket from 'ws';

const METRICS_NAMESPACE = 'VoiceBridge';

const SESSION_TIMEOUT_S = Number(process.env['NOVA_SONIC_SESSION_TIMEOUT_S'] ?? 470); // 7:50 default

/**
 * Proactively resolve the caller to a patient using their phone number. When
 * exactly one patient matches, we return them so the system prompt can greet
 * the caller by name and tool calls can be scope-locked from message 1.
 *
 * On any failure (no match, multiple matches, tool error) returns undefined —
 * the model will fall back to verifying identity verbally.
 */
async function resolveCaller(tenantId: string, callerPhone: string): Promise<IResolvedPatient | undefined> {
  try {
    const res = await executeTool({
      tool: 'searchPatients',
      input: { phone: callerPhone },
      context: { tenantId, callerPhone },
    });
    if (!res.success || !Array.isArray(res.result) || res.result.length !== 1) return undefined;
    const p = res.result[0] as IResolvedPatient | undefined;
    return p?.id ? p : undefined;
  } catch (err) {
    console.warn('[Session] resolveCaller failed:', err);
    return undefined;
  }
}

export interface ISessionParams {
  /** Tenant context — passed to every tool call. */
  tenantId: string;
  /** Caller's phone in E.164 (from Twilio start event customParameters). */
  callerPhone?: string;
  /** 'inbound' (default) or 'outbound' — affects system prompt and event-log direction. */
  direction?: 'inbound' | 'outbound';
}

export async function runSession(ws: WebSocket, params: ISessionParams): Promise<void> {
  let sonic: NovaSonicSession | null = null;
  let twilio: TwilioStreamConnection | null = null;
  let callerPatientId: string | undefined;
  let callSid: string | undefined;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let closed = false;

  // Barge-in: when the model is mid-utterance and the caller starts speaking,
  // Nova stops generating audio (its own VAD) — but Twilio still has queued
  // audio frames to play. We send a Twilio `clear` to drop them so the caller
  // doesn't hear the bot talking over them for a beat.
  let assistantSpeaking = false;

  // Metrics — measured against the stream-start timestamp.
  const sessionStartedAt = Date.now();
  let firstAudioEmittedAt: number | null = null;
  let toolCallCount = 0;
  let bargeInCount = 0;

  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    try { await sonic?.close(); } catch { /* ignore */ }
    try { twilio?.close(); } catch { /* ignore */ }

    const sessionDurationS = Math.round((Date.now() - sessionStartedAt) / 1000);
    metrics.emit({
      namespace: METRICS_NAMESPACE,
      dimensions: { TenantId: params.tenantId, Direction: params.direction ?? 'inbound' },
      values: {
        SessionEnded: 1,
        SessionDurationS: sessionDurationS,
        ToolCallCount: toolCallCount,
        BargeInCount: bargeInCount,
      },
      units: { SessionDurationS: 'Seconds' },
    });

    if (callSid) {
      // Fire-and-forget; backend will mark the call ended.
      void eventLog.endCall(callSid);
    }
  };

  const handleSonicEvent = async (event: SonicEvent): Promise<void> => {
    switch (event.type) {
      case 'audio':
        if (firstAudioEmittedAt === null) {
          firstAudioEmittedAt = Date.now();
          metrics.emit({
            namespace: METRICS_NAMESPACE,
            dimensions: { TenantId: params.tenantId, Direction: params.direction ?? 'inbound' },
            values: { FirstAudioLatencyMs: firstAudioEmittedAt - sessionStartedAt },
            units: { FirstAudioLatencyMs: 'Milliseconds' },
          });
        }
        assistantSpeaking = true;
        twilio?.sendAudio(pcm16kToMulaw8k(event.pcm16kBase64));
        return;
      case 'text':
        // Useful for logging / observability
        if (event.role === 'assistant') console.log(`[Session] Assistant: ${event.text}`);
        return;
      case 'tool_use': {
        toolCallCount++;
        console.log(`[Session] tool_use: ${event.name}(${JSON.stringify(event.input)})`);
        if (callSid) {
          void eventLog.recordEvent(callSid, 'tool_use', { name: event.name, input: event.input });
        }
        const result = await executeTool({
          tool: event.name,
          input: event.input,
          context: { tenantId: params.tenantId, callerPhone: params.callerPhone, callerPatientId, callSid },
        });
        // If searchPatients narrows to one match, lock that patient as caller scope.
        if (event.name === 'searchPatients' && result.success && Array.isArray(result.result)) {
          const arr = result.result as { id?: string }[];
          if (arr.length === 1 && arr[0]?.id) {
            callerPatientId = arr[0].id;
            if (callSid) void eventLog.recordPatientResolved(callSid, callerPatientId);
          }
        }
        sonic?.sendToolResult(event.toolUseId, result);
        return;
      }
      case 'turn_complete':
        assistantSpeaking = false;
        return;
      case 'error':
        console.error('[Session] Nova Sonic error:', event.error);
        await cleanup();
        return;
    }
  };

  twilio = new TwilioStreamConnection(ws, {
    onStart: async (e: ITwilioStartEvent) => {
      callSid = e.callSid;
      const callerPhone = e.customParameters?.['fromPhone'] ?? params.callerPhone;
      const goal = e.customParameters?.['goal'];
      const direction = params.direction ?? 'inbound';
      console.log(`[Session] Stream started: callSid=${e.callSid} from=${callerPhone} direction=${direction}${goal ? ` goal="${goal}"` : ''}`);

      // Record stream-start, start recording, fetch schemas, and resolve caller
      // ALL IN PARALLEL — first-audio latency is bounded by max(), not sum().
      // Recording start and event log are fire-and-forget; we wait only for
      // the two paths the Sonic session needs (schemas + patient).
      void eventLog.startCall({
        callSid,
        tenantId: params.tenantId,
        direction,
        fromPhone: callerPhone,
      });
      void startRecording(callSid).then((r) => {
        if (!r.success) console.warn(`[Session] recording start failed: ${r.error}`);
        else void eventLog.recordEvent(callSid!, 'recording_started', { recordingSid: r.recordingSid });
      });

      const [schemasResult, patient] = await Promise.all([
        fetchSchemas().catch((err) => { console.error('[Session] fetchSchemas failed:', err); return null; }),
        callerPhone ? resolveCaller(params.tenantId, callerPhone) : Promise.resolve(undefined),
      ]);

      if (!schemasResult) {
        await cleanup();
        return;
      }

      if (patient) {
        callerPatientId = patient.id;
        console.log(`[Session] Caller resolved to patient ${patient.id} (${patient.firstName ?? '?'})`);
        void eventLog.recordPatientResolved(callSid, patient.id);
      }

      const systemPrompt = buildSystemPrompt(patient, callerPhone, { direction, goal });

      sonic = new NovaSonicSession({ systemPrompt, tools: schemasResult });
      sonic.on((ev) => { void handleSonicEvent(ev); });
      await sonic.open();

      // Stream-start metric: one count per successful Sonic open.
      metrics.emit({
        namespace: METRICS_NAMESPACE,
        dimensions: { TenantId: params.tenantId, Direction: params.direction ?? 'inbound' },
        values: { StreamStarted: 1, PatientResolved: patient ? 1 : 0 },
      });

      // Hard-cap the session at SESSION_TIMEOUT_S to stay under Nova's 8-min limit.
      timeoutHandle = setTimeout(() => {
        console.log('[Session] Session cap reached; closing gracefully');
        metrics.emit({
          namespace: METRICS_NAMESPACE,
          dimensions: { TenantId: params.tenantId, Direction: params.direction ?? 'inbound' },
          values: { SessionCapReached: 1 },
        });
        void cleanup();
      }, SESSION_TIMEOUT_S * 1000);
    },
    onMedia: (e) => {
      if (e.track !== 'inbound') return;
      // Barge-in: if the caller starts talking while we have outbound audio
      // queued in Twilio, drop the queue so we don't talk over them.
      // (Nova will have stopped generating its own audio already via VAD.)
      if (assistantSpeaking) {
        assistantSpeaking = false;
        bargeInCount++;
        twilio?.clearOutboundAudio();
      }
      const pcm16k = mulaw8kToPcm16k(e.payload);
      sonic?.sendAudio(pcm16k.toString('base64'));
    },
    onDtmf: async (e) => {
      console.log(`[Session] DTMF: ${e.digit} (track=${e.track})`);
      if (callSid) {
        void eventLog.recordEvent(callSid, 'dtmf', { digit: e.digit });
      }
      // "0" is the universally-recognized "operator" digit on phone systems.
      // Trigger transferToHuman immediately — going through the LLM would
      // add latency and the intent is unambiguous.
      if (e.digit === '0' && callSid) {
        toolCallCount++;
        const result = await executeTool({
          tool: 'transferToHuman',
          input: { reason: 'caller pressed 0' },
          context: { tenantId: params.tenantId, callerPhone: params.callerPhone, callerPatientId, callSid },
        });
        if (!result.success) {
          console.warn(`[Session] transferToHuman from DTMF failed: ${result.error}`);
        }
        // Twilio will tear down the stream once the Update Call TwiML takes over.
      }
    },
    onStop: () => { void cleanup(); },
    onError: (err) => {
      console.error('[Session] Twilio stream error:', err);
      void cleanup();
    },
  });
}
