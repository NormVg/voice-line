/**
 * Pure PCM helpers — no I/O, no browser APIs.
 * All functions operate on ArrayBuffer / typed arrays.
 */

/** Convert Float32 samples (-1..1) to 16-bit little-endian PCM. */
export function float32ToPcm16(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const sample = float32[i] ?? 0;
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Convert 16-bit little-endian PCM to Float32 samples (-1..1). */
export function pcm16ToFloat32(pcm: ArrayBuffer): Float32Array {
  const view = new DataView(pcm);
  const out = new Float32Array(pcm.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    const int16 = view.getInt16(i * 2, true);
    out[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

/** RMS energy of a Float32 buffer, normalized 0–1. */
export function rmsEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Linear resample from `fromRate` to `toRate`.
 * Good enough for voice; not a high-quality SRC.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  if (input.length === 0) return new Float32Array(0);

  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIndex - i0;
    const s0 = input[i0] ?? 0;
    const s1 = input[i1] ?? 0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

/** Concatenate multiple ArrayBuffers into one. */
export function concatArrayBuffers(chunks: readonly ArrayBuffer[]): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/** Build a minimal WAV (PCM16 LE) container around raw PCM. */
export function pcm16ToWav(pcm: ArrayBuffer, sampleRate: number, channels = 1): ArrayBuffer {
  const dataLength = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataLength, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm));

  return buffer;
}
