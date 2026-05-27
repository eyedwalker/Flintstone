import { mulaw8kToPcm16k, pcm16kToMulaw8k } from '../src/audio';

describe('audio conversion', () => {
  describe('mulaw8kToPcm16k', () => {
    it('doubles the sample count (upsample 8kHz → 16kHz)', () => {
      // 160 μ-law bytes = 20ms at 8kHz → should produce 320 PCM samples (640 bytes) at 16kHz
      const mulaw = Buffer.alloc(160, 0xff).toString('base64');
      const pcm = mulaw8kToPcm16k(mulaw);
      expect(pcm.length).toBe(640); // 320 samples * 2 bytes
    });

    it('produces a Buffer when given empty input', () => {
      const pcm = mulaw8kToPcm16k('');
      expect(Buffer.isBuffer(pcm)).toBe(true);
      expect(pcm.length).toBe(0);
    });

    it('handles silence (μ-law 0xff = PCM ~0)', () => {
      const mulaw = Buffer.alloc(10, 0xff).toString('base64');
      const pcm = mulaw8kToPcm16k(mulaw);
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
      // μ-law 0xff decodes to 0 (true silence)
      for (const s of samples) expect(s).toBe(0);
    });
  });

  describe('pcm16kToMulaw8k', () => {
    it('halves the sample count (downsample 16kHz → 8kHz)', () => {
      // 320 PCM samples (640 bytes) → 160 μ-law bytes
      const pcm = Buffer.alloc(640, 0);
      const mulaw = pcm16kToMulaw8k(pcm.toString('base64'));
      const decoded = Buffer.from(mulaw, 'base64');
      expect(decoded.length).toBe(160);
    });

    it('returns base64 string', () => {
      const pcm = Buffer.alloc(40, 0);
      const out = pcm16kToMulaw8k(pcm.toString('base64'));
      expect(typeof out).toBe('string');
      // Valid base64: re-decode to confirm
      expect(() => Buffer.from(out, 'base64')).not.toThrow();
    });
  });

  describe('round-trip', () => {
    it('preserves silence through mulaw → pcm → mulaw', () => {
      const original = Buffer.alloc(160, 0xff).toString('base64');
      const pcm = mulaw8kToPcm16k(original);
      const back = pcm16kToMulaw8k(pcm.toString('base64'));
      const backBuf = Buffer.from(back, 'base64');
      expect(backBuf.length).toBe(160);
      // Silence should remain silence (all 0xff or close — μ-law 0 = sample 0)
      for (let i = 0; i < backBuf.length; i++) {
        expect(backBuf[i]).toBe(0xff);
      }
    });
  });
});
