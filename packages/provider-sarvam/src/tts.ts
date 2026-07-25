import type { AudioChunk, TTSConfig, TTSProvider } from "@voice-line/core";
import { authHeaders, resolveApiKey, SARVAM_BASE_URL, type SarvamCredentials } from "./shared.js";

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
  private activeControllers = new Set<AbortController>();

  constructor(options: SarvamTTSOptions = {}) {
    this.options = options;
    this.apiKey = resolveApiKey(options.apiKey);
    this.baseUrl = options.baseUrl ?? SARVAM_BASE_URL;
  }

  async *synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk> {
    const trimmed = text.trim();
    if (!trimmed) return;

    const controller = new AbortController();
    this.activeControllers.add(controller);
    const signal = controller.signal;

    const body = {
      text: trimmed,
      target_language_code: config.language ?? this.options.language ?? "en-IN",
      model: config.model ?? this.options.model ?? "bulbul:v3",
      speaker: config.voice ?? this.options.voice ?? "shubh",
      pace: config.pace ?? this.options.pace ?? 1.0,
      speech_sample_rate: String(config.sampleRate ?? this.options.sampleRate ?? 16_000),
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

      let data = base64ToArrayBuffer(b64);
      const view = new Uint8Array(data);
      if (
        view.length >= 44 &&
        view[0] === 0x52 && // R
        view[1] === 0x49 && // I
        view[2] === 0x46 && // F
        view[3] === 0x46 // F
      ) {
        data = data.slice(44);
      }

      yield {
        data,
        sampleRate: config.sampleRate ?? this.options.sampleRate ?? 16_000,
        format: config.format ?? "pcm16",
      };
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  abort(): void {
    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
  }

  private async *readStream(
    body: ReadableStream<Uint8Array>,
    config: TTSConfig,
  ): AsyncIterable<AudioChunk> {
    const reader = body.getReader();
    const sampleRate = config.sampleRate ?? this.options.sampleRate ?? 16_000;
    let pending = new Uint8Array(0);
    let headerHandled = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        let currentChunk = value;

        // On first data: detect and skip WAV header if present
        if (!headerHandled) {
          headerHandled = true;
          // WAV files start with ASCII "RIFF"
          if (
            currentChunk.length >= 4 &&
            currentChunk[0] === 0x52 && // R
            currentChunk[1] === 0x49 && // I
            currentChunk[2] === 0x46 && // F
            currentChunk[3] === 0x46 // F
          ) {
            const headerSize = 44;
            if (currentChunk.length <= headerSize) continue;
            currentChunk = currentChunk.subarray(headerSize);
          }
        }

        const totalLength = pending.length + currentChunk.length;
        const validBytes = totalLength - (totalLength % 2);

        if (validBytes === 0) {
          const newPending = new Uint8Array(totalLength);
          newPending.set(pending);
          newPending.set(currentChunk, pending.length);
          pending = newPending;
          continue;
        }

        const toYield = new Uint8Array(validBytes);
        const nextPending = new Uint8Array(totalLength - validBytes);

        if (pending.length > 0) {
          toYield.set(pending);
          toYield.set(currentChunk.subarray(0, validBytes - pending.length), pending.length);
          nextPending.set(currentChunk.subarray(validBytes - pending.length));
        } else {
          toYield.set(currentChunk.subarray(0, validBytes));
          nextPending.set(currentChunk.subarray(validBytes));
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
