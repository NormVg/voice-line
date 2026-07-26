import type {
  AudioChunk,
  STTConfig,
  STTProvider,
  STTStream,
  STTStreamEventMap,
  TTSProvider,
  Unsubscribe,
} from "@voice-line/core";

type HandlerMap = {
  [K in keyof STTStreamEventMap]: Set<(payload: STTStreamEventMap[K]) => void>;
};

/**
 * Mock STT that emits a fixed final transcript on flush/close.
 * Optionally echoes partials after N writes.
 */
export class MockSTT implements STTProvider {
  constructor(
    private readonly transcript = "hello from mic",
    private readonly language = "en-IN",
  ) {}

  createStream(_config: STTConfig): STTStream {
    const handlers: HandlerMap = {
      transcript: new Set(),
      error: new Set(),
      speech_start: new Set(),
      speech_end: new Set(),
    };
    let writes = 0;
    let closed = false;
    let finalized = false;

    const emitFinal = () => {
      if (closed || finalized) return;
      finalized = true;
      for (const h of handlers.transcript) {
        h({
          text: this.transcript,
          isFinal: true,
          language: this.language,
          confidence: 1,
        });
      }
    };

    return {
      write: () => {
        writes += 1;
        if (writes === 1) {
          for (const h of handlers.transcript) {
            h({
              text: this.transcript.slice(0, 5),
              isFinal: false,
              language: this.language,
              confidence: 0.5,
            });
          }
        }
      },
      on: <E extends keyof STTStreamEventMap>(
        event: E,
        handler: (payload: STTStreamEventMap[E]) => void,
      ): Unsubscribe => {
        handlers[event].add(handler as (p: STTStreamEventMap[E]) => void);
        return () => {
          handlers[event].delete(handler as (p: STTStreamEventMap[E]) => void);
        };
      },
      flush: () => {
        emitFinal();
      },
      close: async () => {
        if (closed) return;
        // If never flushed, still emit so turns complete
        if (writes > 0) emitFinal();
        closed = true;
      },
    };
  }
}

/** Mock TTS that yields one tiny PCM-ish chunk per sentence. */
export class MockTTS implements TTSProvider {
  private aborted = false;
  public synthesized: string[] = [];

  async *synthesize(
    text: string,
    config?: { signal?: AbortSignal },
  ): AsyncIterable<AudioChunk> {
    this.aborted = false;
    this.synthesized.push(text);
    if (this.aborted || config?.signal?.aborted) return;
    // 20ms of silence-ish PCM16 at 16kHz
    const samples = 320;
    const buf = new ArrayBuffer(samples * 2);
    const view = new DataView(buf);
    for (let i = 0; i < samples; i++) {
      // low-amplitude tone so it's real audio data
      const s = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.2;
      view.setInt16(i * 2, Math.round(s * 0x7fff), true);
    }
    yield { data: buf, sampleRate: 16000, format: "pcm16" };
  }

  abort(): void {
    this.aborted = true;
  }
}

/** Generate PCM16 speech-like energy for VAD. */
export function makeSpeechPcm(durationMs = 300, sampleRate = 16000): ArrayBuffer {
  const samples = Math.floor((sampleRate * durationMs) / 1000);
  const buf = new ArrayBuffer(samples * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples; i++) {
    const s = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5;
    view.setInt16(i * 2, Math.round(s * 0x7fff), true);
  }
  return buf;
}

/** Silence PCM for VAD speech_end. */
export function makeSilencePcm(durationMs = 600, sampleRate = 16000): ArrayBuffer {
  return new ArrayBuffer(Math.floor((sampleRate * durationMs) / 1000) * 2);
}

export function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 10,
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
