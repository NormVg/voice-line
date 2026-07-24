import type {
  STTConfig,
  STTProvider,
  STTStream,
  STTStreamEventMap,
  TranscriptResult,
  Unsubscribe,
} from "@voice-line/core";
import { pcm16ToWav } from "@voice-line/core";
import { authHeaders, resolveApiKey, SARVAM_BASE_URL, type SarvamCredentials } from "./shared.js";

export interface SarvamSTTOptions extends SarvamCredentials {
  language?: string;
  model?: string;
  mode?: "transcribe" | "translate" | "verbatim" | "translit" | "codemix";
  /**
   * Prefer WebSocket streaming when available (default true).
   * Falls back to REST utterance transcription on flush/close.
   */
  streaming?: boolean;
}

type HandlerMap = {
  [K in keyof STTStreamEventMap]: Set<(payload: STTStreamEventMap[K]) => void>;
};

/**
 * Sarvam Saaras STT stream.
 *
 * Buffers PCM and:
 * - If streaming WS is available, sends base64 chunks over WS
 * - Otherwise REST-transcribes the full utterance on flush/close
 */
export class SarvamSTTStream implements STTStream {
  private readonly options: SarvamSTTOptions;
  private readonly config: STTConfig;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private chunks: ArrayBuffer[] = [];
  private closed = false;
  private ws: WebSocket | null = null;
  private handlers: HandlerMap = {
    transcript: new Set(),
    error: new Set(),
    speech_start: new Set(),
    speech_end: new Set(),
  };

  constructor(options: SarvamSTTOptions, config: STTConfig) {
    this.options = options;
    this.config = config;
    this.apiKey = resolveApiKey(options.apiKey);
    this.baseUrl = options.baseUrl ?? SARVAM_BASE_URL;
  }

  write(chunk: ArrayBuffer): void {
    if (this.closed) return;
    this.chunks.push(chunk);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsChunk(chunk);
    }
  }

  on<E extends keyof STTStreamEventMap>(
    event: E,
    handler: (payload: STTStreamEventMap[E]) => void,
  ): Unsubscribe {
    this.handlers[event].add(handler as (payload: STTStreamEventMap[E]) => void);
    return () => {
      this.handlers[event].delete(handler as (payload: STTStreamEventMap[E]) => void);
    };
  }

  flush(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "flush" }));
      return;
    }
    void this.transcribeRest();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    } else if (this.chunks.length > 0) {
      await this.transcribeRest();
    }
    this.chunks = [];
  }

  /** Open WS streaming connection (called lazily). */
  async connectStreaming(): Promise<void> {
    if (this.ws || this.options.streaming === false) return;

    const model = this.config.model ?? this.options.model ?? "saaras:v3";
    const params = new URLSearchParams({
      "api-subscription-key": this.apiKey,
      model,
      "high-vad-sensitivity": "true",
      "flush-signal": "true",
    });
    const language = this.config.language ?? this.options.language;
    if (language) params.set("language-code", language);

    const url = `${this.baseUrl.replace("https", "wss")}/speech-to-text/ws?${params}`;

    try {
      this.ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        if (!this.ws) return reject(new Error("WS missing"));
        this.ws.onopen = () => resolve();
        this.ws.onerror = () => reject(new Error("Sarvam STT WebSocket failed"));
      });

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          this.handleWsMessage(msg);
        } catch (err) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      };

      // Send any buffered audio
      for (const chunk of this.chunks) {
        this.sendWsChunk(chunk);
      }
    } catch {
      // Fall back to REST — keep buffering
      this.ws = null;
    }
  }

  private sendWsChunk(chunk: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const sampleRate = this.config.sampleRate ?? 16_000;
    const b64 = arrayBufferToBase64(chunk);
    this.ws.send(
      JSON.stringify({
        audio: b64,
        encoding: "audio/wav", // pcm sent as raw; API also accepts pcm_s16le
        sample_rate: sampleRate,
      }),
    );
  }

  private handleWsMessage(msg: Record<string, unknown>): void {
    const type = msg.type ?? msg.event;
    if (type === "START_SPEECH" || type === "speech_start") {
      this.emit("speech_start", undefined as void);
      return;
    }
    if (type === "END_SPEECH" || type === "speech_end") {
      this.emit("speech_end", undefined as void);
      return;
    }

    const text =
      (typeof msg.transcript === "string" && msg.transcript) ||
      (typeof msg.text === "string" && msg.text) ||
      "";
    if (!text) return;

    const isFinal =
      msg.is_final === true ||
      msg.isFinal === true ||
      type === "transcript" ||
      msg.status === "final";

    const result: TranscriptResult = {
      text,
      isFinal: Boolean(isFinal),
      language: String(msg.language_code ?? msg.language ?? this.options.language ?? "unknown"),
      confidence: typeof msg.confidence === "number" ? msg.confidence : 1,
    };
    this.emit("transcript", result);
  }

  private async transcribeRest(): Promise<void> {
    if (this.chunks.length === 0) return;
    const sampleRate = this.config.sampleRate ?? 16_000;
    const pcm = concat(this.chunks);
    this.chunks = [];
    const wav = pcm16ToWav(pcm, sampleRate);

    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
      form.append("model", this.config.model ?? this.options.model ?? "saaras:v3");
      form.append("mode", this.options.mode ?? "transcribe");
      const language = this.config.language ?? this.options.language;
      if (language) form.append("language_code", language);

      const res = await fetch(`${this.baseUrl}/speech-to-text`, {
        method: "POST",
        headers: authHeaders(this.apiKey),
        body: form,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Sarvam STT ${res.status}: ${body}`);
      }

      const json = (await res.json()) as {
        transcript?: string;
        language_code?: string;
      };

      const text = json.transcript ?? "";
      if (text) {
        this.emit("transcript", {
          text,
          isFinal: true,
          language: json.language_code ?? language ?? "unknown",
          confidence: 1,
        });
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  private emit<E extends keyof STTStreamEventMap>(event: E, payload: STTStreamEventMap[E]): void {
    for (const h of this.handlers[event]) {
      h(payload);
    }
  }
}

export class SarvamSTTProvider implements STTProvider {
  private readonly options: SarvamSTTOptions;

  constructor(options: SarvamSTTOptions = {}) {
    this.options = options;
  }

  createStream(config: STTConfig): STTStream {
    const stream = new SarvamSTTStream(this.options, config);
    // Fire-and-forget WS connect; REST fallback if it fails
    if (this.options.streaming !== false) {
      void stream.connectStreaming();
    }
    return stream;
  }
}

function concat(chunks: ArrayBuffer[]): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(new Uint8Array(c), offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}
