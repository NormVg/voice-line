import type { AudioChunk, TTSConfig, TTSProvider } from "@voice-line/core";
import {
  authHeaders,
  resolveApiKey,
  SARVAM_BASE_URL,
  type SarvamCredentials,
} from "./shared.js";

export interface SarvamTTSOptions extends SarvamCredentials {
  /** Default speaker. bulbul:v3 default is `shubh`. */
  voice?: string;
  language?: string;
  model?: string;
  pace?: number;
  sampleRate?: number;
}

/**
 * Sarvam Bulbul TTS provider.
 * Uses HTTP streaming when available, REST otherwise.
 */
export class SarvamTTSProvider implements TTSProvider {
  private readonly options: SarvamTTSOptions;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(options: SarvamTTSOptions = {}) {
    this.options = options;
    this.apiKey = resolveApiKey(options.apiKey);
    this.baseUrl = options.baseUrl ?? SARVAM_BASE_URL;
  }

  async *synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk> {
    const trimmed = text.trim();
    if (!trimmed) return;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const body = {
      text: trimmed,
      target_language_code:
        config.language ?? this.options.language ?? "en-IN",
      model: config.model ?? this.options.model ?? "bulbul:v3",
      speaker: config.voice ?? this.options.voice ?? "shubh",
      pace: config.pace ?? this.options.pace ?? 1.0,
      speech_sample_rate: String(
        config.sampleRate ?? this.options.sampleRate ?? 16_000,
      ),
    };

    try {
      // Prefer HTTP stream endpoint
      const streamRes = await fetch(`${this.baseUrl}/text-to-speech/stream`, {
        method: "POST",
        headers: {
          ...authHeaders(this.apiKey),
          "Content-Type": "application/json",
          Accept: "audio/wav, application/octet-stream",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (streamRes.ok && streamRes.body) {
        yield* this.readStream(streamRes.body, config);
        return;
      }

      // REST fallback
      const res = await fetch(`${this.baseUrl}/text-to-speech`, {
        method: "POST",
        headers: {
          ...authHeaders(this.apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Sarvam TTS ${res.status}: ${errBody}`);
      }

      const json = (await res.json()) as { audios?: string[] };
      const b64 = json.audios?.[0];
      if (!b64) return;

      const data = base64ToArrayBuffer(b64);
      yield {
        data,
        sampleRate: config.sampleRate ?? this.options.sampleRate ?? 16_000,
        format: config.format ?? "pcm16",
      };
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private async *readStream(
    body: ReadableStream<Uint8Array>,
    config: TTSConfig,
  ): AsyncIterable<AudioChunk> {
    const reader = body.getReader();
    const sampleRate = config.sampleRate ?? this.options.sampleRate ?? 16_000;
    let pending = new Uint8Array(0);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const totalLength = pending.length + value.length;
        const validBytes = totalLength - (totalLength % 2);

        if (validBytes === 0) {
          const newPending = new Uint8Array(totalLength);
          newPending.set(pending);
          newPending.set(value, pending.length);
          pending = newPending;
          continue;
        }

        const toYield = new Uint8Array(validBytes);
        const nextPending = new Uint8Array(totalLength - validBytes);

        if (pending.length > 0) {
          toYield.set(pending);
          toYield.set(value.subarray(0, validBytes - pending.length), pending.length);
          nextPending.set(value.subarray(validBytes - pending.length));
        } else {
          toYield.set(value.subarray(0, validBytes));
          nextPending.set(value.subarray(validBytes));
        }

        pending = nextPending;
        yield {
          data: toYield.buffer,
          sampleRate,
          format: config.format ?? "pcm16",
        };
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.buffer;
  }
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
