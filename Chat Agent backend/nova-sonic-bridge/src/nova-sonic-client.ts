/**
 * Nova Sonic 2 bidirectional streaming client.
 *
 * Bridges WebSocket-style audio I/O between Twilio Media Streams (caller side)
 * and Bedrock InvokeModelWithBidirectionalStream (model side).
 *
 * Audio contract:
 *   • Input  : 16kHz 16-bit signed PCM, base64-encoded, ~20ms chunks
 *   • Output : 16kHz 16-bit signed PCM, base64-encoded
 *
 * Event flow (high level):
 *   1. open()       → opens the stream and sends sessionStart + promptStart
 *   2. sendAudio()  → push caller audio chunks (called from Twilio handler)
 *   3. onEvent      → fired for every model output event (audioOutput / textOutput / toolUse / contentEnd)
 *   4. sendToolResult() → push a tool_result back when the bridge resolves a tool_use
 *   5. close()      → graceful shutdown (sessionEnd + close)
 *
 * IMPORTANT: The exact JSON shape of Nova Sonic 2 events is service-defined
 * and may differ in subtle ways from this scaffold. Before going to prod,
 * verify event names + payload shapes against either:
 *   - The Bedrock SDK type definitions (run `npx tsc` against the SDK types)
 *   - A live capture from a smoke test once model access is granted
 * Spots that need verification are marked `// VERIFY:`.
 */

import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { IToolSchema } from './tool-bridge';

const REGION = process.env['AWS_REGION'] ?? 'us-east-1';
const MODEL_ID = process.env['AWS_BEDROCK_NOVA_SONIC_MODEL_ID'] ?? 'amazon.nova-2-sonic-v1:0';
const DEFAULT_VOICE = process.env['NOVA_SONIC_DEFAULT_VOICE'] ?? 'tiffany';

export interface ISonicSessionConfig {
  systemPrompt: string;
  tools: IToolSchema[];
  voice?: string;
}

export interface ISonicAudioEvent { type: 'audio'; pcm16kBase64: string }
export interface ISonicTextEvent { type: 'text'; text: string; role: 'assistant' | 'user' }
export interface ISonicToolUseEvent { type: 'tool_use'; toolUseId: string; name: string; input: Record<string, unknown> }
export interface ISonicTurnCompleteEvent { type: 'turn_complete' }
export interface ISonicErrorEvent { type: 'error'; error: string }
export type SonicEvent = ISonicAudioEvent | ISonicTextEvent | ISonicToolUseEvent | ISonicTurnCompleteEvent | ISonicErrorEvent;

type EventHandler = (event: SonicEvent) => void;

export class NovaSonicSession {
  private client: BedrockRuntimeClient;
  private inputQueue: { chunk: Record<string, unknown> }[] = [];
  private inputResolver: ((value: { chunk: Record<string, unknown> } | undefined) => void) | null = null;
  private closed = false;
  private handlers: EventHandler[] = [];

  constructor(private readonly config: ISonicSessionConfig) {
    this.client = new BedrockRuntimeClient({ region: REGION });
  }

  on(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Open the bidirectional stream. Returns when the stream is established
   * and the initial sessionStart/promptStart events have been queued.
   */
  async open(): Promise<void> {
    // VERIFY: exact event names and field shapes against live Nova Sonic 2.
    // The structure here matches the published Bedrock bidirectional-stream
    // pattern (event-shaped JSON wrapped in {chunk: {bytes: ...}}). Adjust
    // event types here if the live service uses a different envelope.
    this.queueInput({
      sessionStart: {
        inferenceConfiguration: {
          maxTokens: 1024,
          temperature: 0.7,
          topP: 0.9,
        },
      },
    });

    this.queueInput({
      promptStart: {
        promptName: 'default',
        textOutputConfiguration: { mediaType: 'text/plain' },
        audioOutputConfiguration: {
          mediaType: 'audio/lpcm',
          sampleRateHertz: 16000,
          sampleSizeBits: 16,
          channelCount: 1,
          voiceId: this.config.voice ?? DEFAULT_VOICE,
          encoding: 'base64',
        },
        toolUseOutputConfiguration: { mediaType: 'application/json' },
        toolConfiguration: { tools: this.config.tools },
      },
    });

    // System prompt is sent as a text content block.
    this.queueInput({
      contentStart: { promptName: 'default', contentName: 'system', type: 'TEXT', role: 'SYSTEM' },
    });
    this.queueInput({
      textInput: { promptName: 'default', contentName: 'system', content: this.config.systemPrompt },
    });
    this.queueInput({
      contentEnd: { promptName: 'default', contentName: 'system' },
    });

    // Audio content block stays open for the duration of the session;
    // audioInput events are pushed onto it as they arrive from Twilio.
    this.queueInput({
      contentStart: {
        promptName: 'default', contentName: 'audio', type: 'AUDIO', role: 'USER',
        audioInputConfiguration: {
          mediaType: 'audio/lpcm',
          sampleRateHertz: 16000,
          sampleSizeBits: 16,
          channelCount: 1,
          encoding: 'base64',
        },
      },
    });

    // Fire-and-forget the stream — the consumer iterator below drives both
    // sides of the conversation.
    void this.run();
  }

  /** Push a 16kHz PCM audio chunk from the caller into the model. */
  sendAudio(pcm16kBase64: string): void {
    if (this.closed) return;
    this.queueInput({
      audioInput: { promptName: 'default', contentName: 'audio', content: pcm16kBase64 },
    });
  }

  /** Push a tool result back to the model after the bridge resolves a tool_use. */
  sendToolResult(toolUseId: string, result: unknown): void {
    if (this.closed) return;
    const contentName = `tool-${toolUseId}`;
    this.queueInput({
      contentStart: {
        promptName: 'default', contentName, type: 'TOOL', role: 'TOOL',
        toolResultInputConfiguration: { toolUseId, type: 'TEXT' },
      },
    });
    this.queueInput({
      toolResult: { promptName: 'default', contentName, content: JSON.stringify(result) },
    });
    this.queueInput({ contentEnd: { promptName: 'default', contentName } });
  }

  /** Gracefully close the session. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queueInput({ contentEnd: { promptName: 'default', contentName: 'audio' } });
    this.queueInput({ promptEnd: { promptName: 'default' } });
    this.queueInput({ sessionEnd: {} });
    // Wake the iterator so it can drain.
    this.resolveNext(undefined);
  }

  private queueInput(event: Record<string, unknown>): void {
    const chunk = { chunk: { bytes: Buffer.from(JSON.stringify({ event }), 'utf-8') } };
    if (this.inputResolver) {
      const r = this.inputResolver;
      this.inputResolver = null;
      r(chunk);
    } else {
      this.inputQueue.push(chunk);
    }
  }

  private resolveNext(v: { chunk: Record<string, unknown> } | undefined): void {
    if (this.inputResolver) {
      const r = this.inputResolver;
      this.inputResolver = null;
      r(v);
    }
  }

  private async *inputIterator(): AsyncGenerator<{ chunk: Record<string, unknown> }, void, unknown> {
    while (!this.closed || this.inputQueue.length > 0) {
      if (this.inputQueue.length > 0) {
        yield this.inputQueue.shift()!;
        continue;
      }
      const next = await new Promise<{ chunk: Record<string, unknown> } | undefined>((resolve) => {
        this.inputResolver = resolve;
      });
      if (!next) return;
      yield next;
    }
  }

  private emit(event: SonicEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch (e) { console.error('[NovaSonic] handler error:', e); }
    }
  }

  private async run(): Promise<void> {
    try {
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: MODEL_ID,
        // The SDK type for `body` is an AsyncIterable — matches our generator.
        body: this.inputIterator() as unknown as AsyncIterable<{ chunk: { bytes: Uint8Array } }>,
      });
      const response = await this.client.send(command);
      if (!response.body) {
        this.emit({ type: 'error', error: 'No response body from Bedrock' });
        return;
      }
      for await (const event of response.body) {
        this.handleOutputEvent(event);
      }
    } catch (err) {
      this.emit({ type: 'error', error: String(err) });
    } finally {
      this.closed = true;
    }
  }

  private handleOutputEvent(event: unknown): void {
    // Each output is a {chunk: {bytes: Uint8Array}} containing a JSON-encoded event.
    const e = event as { chunk?: { bytes?: Uint8Array } };
    if (!e.chunk?.bytes) return;
    let parsed: { event?: Record<string, unknown> };
    try {
      parsed = JSON.parse(Buffer.from(e.chunk.bytes).toString('utf-8'));
    } catch {
      return;
    }
    if (!parsed.event) return;
    const evt = parsed.event;

    // VERIFY: branch names against the live service.
    if (evt['audioOutput']) {
      const a = evt['audioOutput'] as { content?: string };
      if (a.content) this.emit({ type: 'audio', pcm16kBase64: a.content });
      return;
    }
    if (evt['textOutput']) {
      const t = evt['textOutput'] as { content?: string; role?: string };
      this.emit({ type: 'text', text: t.content ?? '', role: (t.role === 'USER' ? 'user' : 'assistant') });
      return;
    }
    if (evt['toolUse']) {
      const t = evt['toolUse'] as { toolUseId?: string; toolName?: string; content?: string };
      let input: Record<string, unknown> = {};
      try { input = t.content ? JSON.parse(t.content) : {}; } catch { /* ignore */ }
      this.emit({ type: 'tool_use', toolUseId: t.toolUseId ?? '', name: t.toolName ?? '', input });
      return;
    }
    if (evt['contentEnd']) {
      const c = evt['contentEnd'] as { stopReason?: string };
      if (c.stopReason === 'END_TURN') this.emit({ type: 'turn_complete' });
      return;
    }
  }
}
