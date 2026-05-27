/**
 * Audio format conversion between Twilio Media Streams and Bedrock Nova Sonic.
 *
 * Twilio Media Streams emits 8kHz μ-law (G.711) audio, base64-encoded, in
 * frames of 160 samples (20ms each).
 *
 * Bedrock Nova Sonic expects 16kHz 16-bit signed PCM, little-endian,
 * base64-encoded. Sonic's audioOutput events likewise return 16kHz PCM
 * which must be downsampled to 8kHz μ-law before sending back to Twilio.
 *
 * The μ-law lookup table here is the standard G.711 encoding (ITU-T G.711).
 */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** Decode a single μ-law byte to a signed 16-bit PCM sample. */
function mulawDecodeByte(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}

/** Encode a signed 16-bit PCM sample to a μ-law byte. */
function mulawEncodeSample(pcm: number): number {
  let sign = 0;
  if (pcm < 0) {
    pcm = -pcm;
    sign = 0x80;
  }
  if (pcm > MULAW_CLIP) pcm = MULAW_CLIP;
  pcm += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/**
 * Convert Twilio's 8kHz μ-law audio (base64) to 16kHz 16-bit PCM (Buffer).
 * Naive 2x linear-interpolation upsample — good enough for speech.
 */
export function mulaw8kToPcm16k(mulawB64: string): Buffer {
  const mu = Buffer.from(mulawB64, 'base64');
  const pcm8k = new Int16Array(mu.length);
  for (let i = 0; i < mu.length; i++) pcm8k[i] = mulawDecodeByte(mu[i]!);

  // Upsample 8kHz → 16kHz via linear interpolation.
  const pcm16k = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    pcm16k[i * 2] = pcm8k[i]!;
    const next = i + 1 < pcm8k.length ? pcm8k[i + 1]! : pcm8k[i]!;
    pcm16k[i * 2 + 1] = (pcm8k[i]! + next) >> 1;
  }

  // Int16Array → Buffer (little-endian, native on x86/arm)
  return Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength);
}

/**
 * Convert Nova Sonic's 16kHz 16-bit PCM audio (base64) to 8kHz μ-law (base64).
 * Decimating 2:1 (drop every other sample) — fine for speech; for music use a low-pass filter first.
 */
export function pcm16kToMulaw8k(pcmB64: string): string {
  const pcmBuf = Buffer.from(pcmB64, 'base64');
  const pcm16k = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength / 2);
  const out = Buffer.allocUnsafe(Math.floor(pcm16k.length / 2));
  for (let i = 0, j = 0; i < pcm16k.length - 1; i += 2, j++) {
    out[j] = mulawEncodeSample(pcm16k[i]!);
  }
  return out.toString('base64');
}
