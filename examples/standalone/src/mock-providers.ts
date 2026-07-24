import type {
  AudioChunk,
  STTConfig,
  STTProvider,
  STTStream,
  STTStreamEventMap,
  TTSProvider,
  Unsubscribe,
} from "@voice-line/core";

/** Demo STT — returns a canned transcript after audio arrives. */
export class DemoSTT implements STTProvider {
  createStream(_config: STTConfig): STTStream {
    const handlers = new Map<string, Set<(p: unknown) => void>>();
    let gotAudio = false;

    const on = <E extends keyof STTStreamEventMap>(
      event: E,
      handler: (payload: STTStreamEventMap[E]) => void,
    ): Unsubscribe => {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler as (p: unknown) => void);
      return () => set?.delete(handler as (p: unknown) => void);
    };

    const emit = (event: string, payload: unknown) => {
      for (const h of handlers.get(event) ?? []) h(payload);
    };

    return {
      write: () => {
        gotAudio = true;
      },
      on,
      flush: () => {
        if (!gotAudio) return;
        emit("transcript", {
          text: "Hello from the demo microphone path",
          isFinal: true,
          language: "en-IN",
          confidence: 1,
        });
      },
      close: async () => {
        if (gotAudio) {
          emit("transcript", {
            text: "Hello from the demo microphone path",
            isFinal: true,
            language: "en-IN",
            confidence: 1,
          });
        }
      },
    };
  }
}

/** Demo TTS — synthesizes a short tone per sentence (not real speech). */
export class DemoTTS implements TTSProvider {
  private aborted = false;

  async *synthesize(text: string): AsyncIterable<AudioChunk> {
    this.aborted = false;
    const samples = 1600; // 100ms @ 16kHz
    const buf = new ArrayBuffer(samples * 2);
    const view = new DataView(buf);
    for (let i = 0; i < samples; i++) {
      const s = Math.sin((2 * Math.PI * 440 * i) / 16000) * 0.25;
      view.setInt16(i * 2, Math.round(s * 0x7fff), true);
    }
    if (!this.aborted) {
      console.log(`[tts] «${text.slice(0, 80)}${text.length > 80 ? "…" : ""}»`);
      yield { data: buf, sampleRate: 16000, format: "pcm16" };
    }
  }

  abort(): void {
    this.aborted = true;
  }
}
