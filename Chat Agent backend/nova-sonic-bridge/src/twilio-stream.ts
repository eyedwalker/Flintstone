/**
 * Twilio Media Streams protocol handler.
 *
 * Twilio sends JSON frames over WebSocket with these event types:
 *   • connected  — first message, protocol version
 *   • start      — call started; carries streamSid, callSid, customParameters
 *   • media      — base64-encoded μ-law 8kHz audio chunk (20ms per frame)
 *   • mark       — application-level marker (returned later in `mark` events)
 *   • stop       — call ended
 *
 * The bridge sends frames back to Twilio:
 *   • media      — base64-encoded μ-law 8kHz audio (Twilio plays it to caller)
 *   • mark       — application marker (we use this to know when our audio finished playing)
 *   • clear      — drop any queued outbound audio (used for barge-in)
 *
 * Reference: https://www.twilio.com/docs/voice/twiml/stream
 */

import type WebSocket from 'ws';

export interface ITwilioStartEvent {
  streamSid: string;
  callSid: string;
  customParameters: Record<string, string>;
}

export interface ITwilioMediaEvent {
  payload: string;       // base64 μ-law 8kHz audio
  track: 'inbound' | 'outbound';
  timestamp: string;
  chunk: string;
}

export interface ITwilioDtmfEvent {
  /** Single digit string, '0'-'9', '*', or '#'. */
  digit: string;
  /** Which track the digit came in on (typically 'inbound_track'). */
  track: string;
}

export interface ITwilioEventHandlers {
  onStart: (e: ITwilioStartEvent) => void;
  onMedia: (e: ITwilioMediaEvent) => void;
  onDtmf?: (e: ITwilioDtmfEvent) => void;
  onStop: () => void;
  onError: (err: Error) => void;
}

export class TwilioStreamConnection {
  private streamSid = '';

  constructor(private readonly ws: WebSocket, private readonly handlers: ITwilioEventHandlers) {
    ws.on('message', (data) => this.handleMessage(data.toString()));
    ws.on('close', () => this.handlers.onStop());
    ws.on('error', (err) => this.handlers.onError(err));
  }

  /** Send a base64 μ-law 8kHz audio chunk back to the caller. */
  sendAudio(mulawB64: string): void {
    if (!this.streamSid || this.ws.readyState !== 1 /* OPEN */) return;
    this.ws.send(JSON.stringify({
      event: 'media',
      streamSid: this.streamSid,
      media: { payload: mulawB64 },
    }));
  }

  /** Drop any queued outbound audio — used when the caller interrupts (barge-in). */
  clearOutboundAudio(): void {
    if (!this.streamSid || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
  }

  /** Insert an application marker; Twilio echoes it back when the queued audio plays through. */
  sendMark(name: string): void {
    if (!this.streamSid || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({
      event: 'mark',
      streamSid: this.streamSid,
      mark: { name },
    }));
  }

  close(): void {
    try { this.ws.close(1000, 'session ended'); } catch { /* ignore */ }
  }

  private handleMessage(raw: string): void {
    let msg: {
      event?: string;
      streamSid?: string;
      start?: ITwilioStartEvent;
      media?: ITwilioMediaEvent;
      dtmf?: ITwilioDtmfEvent;
    };
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.event) {
      case 'connected':
        return;
      case 'start':
        if (msg.start) {
          this.streamSid = msg.start.streamSid;
          this.handlers.onStart(msg.start);
        }
        return;
      case 'media':
        if (msg.media) this.handlers.onMedia(msg.media);
        return;
      case 'dtmf':
        if (msg.dtmf && this.handlers.onDtmf) this.handlers.onDtmf(msg.dtmf);
        return;
      case 'mark':
        return;
      case 'stop':
        this.handlers.onStop();
        return;
    }
  }
}
