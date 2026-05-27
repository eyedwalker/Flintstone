import { EventEmitter } from 'events';
import { TwilioStreamConnection } from '../src/twilio-stream';

/**
 * Minimal stand-in for `ws.WebSocket` — captures every send() and lets tests
 * inject incoming messages via emit('message', data).
 *
 * `readyState` 1 matches WebSocket.OPEN; the connection reads from this to
 * decide whether to send.
 */
class FakeSocket extends EventEmitter {
  readyState = 1;
  public sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.emit('close'); }
  // Helpers
  sentJson(): unknown[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function setupConn(opts: { withDtmf?: boolean } = {}) {
  const ws = new FakeSocket();
  const onStart = jest.fn();
  const onMedia = jest.fn();
  const onStop = jest.fn();
  const onError = jest.fn();
  const onDtmf = opts.withDtmf ? jest.fn() : undefined;
  const conn = new TwilioStreamConnection(ws as unknown as import('ws').WebSocket, {
    onStart, onMedia, onStop, onError, onDtmf,
  });
  return { ws, conn, onStart, onMedia, onStop, onError, onDtmf };
}

describe('TwilioStreamConnection', () => {
  describe('inbound protocol', () => {
    it('routes start event to onStart and captures streamSid', () => {
      const { ws, onStart } = setupConn();
      ws.emit('message', JSON.stringify({
        event: 'start',
        start: { streamSid: 'MZxyz', callSid: 'CAabc', customParameters: { fromPhone: '+15551234567' } },
      }));
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onStart.mock.calls[0][0]).toMatchObject({
        streamSid: 'MZxyz',
        callSid: 'CAabc',
        customParameters: { fromPhone: '+15551234567' },
      });
    });

    it('routes media events to onMedia', () => {
      const { ws, onMedia } = setupConn();
      ws.emit('message', JSON.stringify({
        event: 'media',
        media: { payload: 'YmFzZTY0', track: 'inbound', timestamp: '20', chunk: '1' },
      }));
      expect(onMedia).toHaveBeenCalledTimes(1);
      expect(onMedia.mock.calls[0][0]).toMatchObject({ payload: 'YmFzZTY0', track: 'inbound' });
    });

    it('ignores unknown event types', () => {
      const { ws, onStart, onMedia, onStop } = setupConn();
      ws.emit('message', JSON.stringify({ event: 'someUnknownThing' }));
      expect(onStart).not.toHaveBeenCalled();
      expect(onMedia).not.toHaveBeenCalled();
      expect(onStop).not.toHaveBeenCalled();
    });

    it('ignores malformed JSON without throwing', () => {
      const { ws } = setupConn();
      expect(() => ws.emit('message', 'not json')).not.toThrow();
    });

    it('routes ws close to onStop', () => {
      const { ws, onStop } = setupConn();
      ws.close();
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('routes ws error to onError', () => {
      const { ws, onError } = setupConn();
      const err = new Error('boom');
      ws.emit('error', err);
      expect(onError).toHaveBeenCalledWith(err);
    });

    it('routes dtmf events to onDtmf when handler is provided', () => {
      const { ws, onDtmf } = setupConn({ withDtmf: true });
      ws.emit('message', JSON.stringify({
        event: 'dtmf',
        streamSid: 'MZ1',
        dtmf: { digit: '0', track: 'inbound_track' },
      }));
      expect(onDtmf).toHaveBeenCalledTimes(1);
      expect(onDtmf!.mock.calls[0][0]).toEqual({ digit: '0', track: 'inbound_track' });
    });

    it('silently drops dtmf events when no handler is registered', () => {
      const { ws } = setupConn(); // no onDtmf
      expect(() => ws.emit('message', JSON.stringify({
        event: 'dtmf', dtmf: { digit: '0', track: 'inbound_track' },
      }))).not.toThrow();
    });
  });

  describe('outbound protocol', () => {
    function start(ws: FakeSocket): void {
      ws.emit('message', JSON.stringify({
        event: 'start',
        start: { streamSid: 'MZxyz', callSid: 'CAabc', customParameters: {} },
      }));
      ws.sent.length = 0; // reset send buffer past the start
    }

    it('sendAudio emits a media event with the streamSid', () => {
      const { ws, conn } = setupConn();
      start(ws);
      conn.sendAudio('YmFzZTY0');
      const sent = ws.sentJson();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        event: 'media',
        streamSid: 'MZxyz',
        media: { payload: 'YmFzZTY0' },
      });
    });

    it('clearOutboundAudio emits a clear event (barge-in)', () => {
      const { ws, conn } = setupConn();
      start(ws);
      conn.clearOutboundAudio();
      const sent = ws.sentJson();
      expect(sent).toEqual([{ event: 'clear', streamSid: 'MZxyz' }]);
    });

    it('does not send before the start event arrives (no streamSid yet)', () => {
      const { ws, conn } = setupConn();
      conn.sendAudio('YmFzZTY0');
      conn.clearOutboundAudio();
      conn.sendMark('m1');
      expect(ws.sent).toEqual([]);
    });

    it('does not send when the socket is closed', () => {
      const { ws, conn } = setupConn();
      start(ws);
      ws.readyState = 3; // CLOSED
      conn.sendAudio('YmFzZTY0');
      expect(ws.sent).toEqual([]);
    });
  });
});
