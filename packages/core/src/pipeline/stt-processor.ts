import type { STTProvider, STTStream } from "../interfaces/stt.js";
import type { Frame, Processor } from "../interfaces/processor.js";
import type { STTConfig } from "../types.js";

export type TranscriptHandler = (frame: Extract<Frame, { kind: "transcript" }>) => void;

/**
 * Streams audio to an STT provider and emits transcript frames.
 *
 * Note: STT results arrive asynchronously via the stream's event emitter.
 * The processor bridges that into the pipeline by invoking `onTranscript`.
 * Session wiring should listen there and push transcript frames as needed.
 */
export class STTProcessor implements Processor {
  readonly name = "stt";

  private stream: STTStream | null = null;
  private readonly provider: STTProvider;
  private readonly config: STTConfig;
  private readonly onTranscript: TranscriptHandler;
  private readonly onError: ((error: Error) => void) | undefined;
  private unsubs: Array<() => void> = [];

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

  process(frame: Frame): Frame | null {
    if (frame.kind === "speech_start") {
      void this.openStream();
      return frame;
    }

    if (frame.kind === "audio") {
      this.ensureStream();
      this.stream?.write(frame.data);
      return null; // audio consumed by STT
    }

    if (frame.kind === "speech_end") {
      this.stream?.flush?.();
      return frame;
    }

    if (frame.kind === "flush") {
      this.stream?.flush?.();
      return frame;
    }

    return frame;
  }

  reset(): void {
    void this.closeStream();
  }

  async destroy(): Promise<void> {
    await this.closeStream();
  }

  private ensureStream(): void {
    if (!this.stream) {
      void this.openStream();
    }
  }

  private openStream(): void {
    if (this.stream) return;
    this.stream = this.provider.createStream(this.config);
    this.unsubs.push(
      this.stream.on("transcript", (result) => {
        this.onTranscript({
          kind: "transcript",
          text: result.text,
          isFinal: result.isFinal,
          language: result.language,
          confidence: result.confidence,
        });
      }),
    );
    this.unsubs.push(
      this.stream.on("error", (error) => {
        this.onError?.(error);
      }),
    );
  }

  private async closeStream(): Promise<void> {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.stream) {
      await this.stream.close();
      this.stream = null;
    }
  }
}
