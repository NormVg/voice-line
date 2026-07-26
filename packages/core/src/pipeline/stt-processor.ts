import type { STTProvider, STTStream } from "../interfaces/stt.js";
import type { Frame, Processor } from "../interfaces/processor.js";
import type { STTConfig } from "../types.js";

export type TranscriptHandler = (frame: Extract<Frame, { kind: "transcript" }>) => void;

/**
 * Streams audio to an STT provider and emits transcript frames.
 *
 * Stream open/close is serialized with a generation token so a late
 * `close()` from a previous utterance cannot tear down a newer stream.
 */
export class STTProcessor implements Processor {
  readonly name = "stt";

  private stream: STTStream | null = null;
  private readonly provider: STTProvider;
  private readonly config: STTConfig;
  private readonly onTranscript: TranscriptHandler;
  private readonly onError: ((error: Error) => void) | undefined;
  private unsubs: Array<() => void> = [];
  /** Bumped on every reopen/reset so stale close() calls no-op. */
  private streamGen = 0;
  /** Chains open/close so concurrent speech_start events cannot race. */
  private lifecycle: Promise<void> = Promise.resolve();

  constructor(options: {
    provider: STTProvider;
    config?: STTConfig;
    onTranscript: TranscriptHandler;
    onError?: (error: Error) => void;
  }) {
    this.provider = options.provider;
    this.config = options.config ?? {};
    this.onTranscript = options.onTranscript;
    this.onError = options.onError;
  }

  process(frame: Frame): Frame | Frame[] | null | Promise<Frame | Frame[] | null> {
    if (frame.kind === "speech_start") {
      return this.reopenStream().then(() => frame);
    }

    if (frame.kind === "audio") {
      if (!this.stream) {
        this.lifecycle = this.lifecycle
          .then(() => {
            if (!this.stream) this.openStream();
          })
          .catch((err: unknown) => {
            this.onError?.(err instanceof Error ? err : new Error(String(err)));
          });
      }
      this.stream?.write(frame.data);
      return null;
    }

    if (frame.kind === "speech_end" || frame.kind === "flush") {
      this.stream?.flush?.();
      return frame;
    }

    return frame;
  }

  reset(): void {
    const gen = ++this.streamGen;
    this.lifecycle = this.lifecycle
      .catch(() => {})
      .then(() => this.closeIfCurrent(gen));
  }

  async destroy(): Promise<void> {
    this.streamGen += 1;
    await this.lifecycle.catch(() => {});
    await this.forceClose();
  }

  private async reopenStream(): Promise<void> {
    const gen = ++this.streamGen;
    this.lifecycle = this.lifecycle
      .catch(() => {})
      .then(async () => {
        await this.closeIfCurrent(gen);
        if (gen !== this.streamGen) return;
        this.openStream();
      });
    await this.lifecycle;
  }

  private openStream(): void {
    if (this.stream) return;
    const gen = this.streamGen;
    this.stream = this.provider.createStream(this.config);
    this.unsubs.push(
      this.stream.on("transcript", (result) => {
        if (gen !== this.streamGen) return;
        this.onTranscript({
          kind: "transcript",
          text: result.text,
          isFinal: result.isFinal,
          language: result.language,
          confidence: result.confidence,
        });
        if (result.isFinal) {
          this.lifecycle = this.lifecycle
            .catch(() => {})
            .then(() => this.closeIfCurrent(gen))
            .catch((err: unknown) => {
              this.onError?.(err instanceof Error ? err : new Error(String(err)));
            });
        }
      }),
    );
    this.unsubs.push(
      this.stream.on("error", (error) => {
        if (gen !== this.streamGen) return;
        this.onError?.(error);
      }),
    );
  }

  /** Close only if `gen` is still the active stream generation. */
  private async closeIfCurrent(gen: number): Promise<void> {
    if (gen !== this.streamGen) return;
    await this.forceClose();
  }

  private async forceClose(): Promise<void> {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (!this.stream) return;
    const s = this.stream;
    this.stream = null;
    try {
      await s.close();
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
