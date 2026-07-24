import type { STTConfig, TranscriptResult, Unsubscribe } from "../types.js";

/**
 * Speech-to-text provider. Stateless factory — creates streams per utterance/session.
 */
export interface STTProvider {
  createStream(config: STTConfig): STTStream;
}

export type STTStreamEventMap = {
  transcript: TranscriptResult;
  error: Error;
  speech_start: void;
  speech_end: void;
};

/**
 * A live STT stream. Write audio chunks; listen for transcripts.
 */
export interface STTStream {
  write(chunk: ArrayBuffer): void;
  on<E extends keyof STTStreamEventMap>(
    event: E,
    handler: (payload: STTStreamEventMap[E]) => void,
  ): Unsubscribe;
  /** Force end-of-utterance (flush partials to final). */
  flush?(): void;
  close(): Promise<void>;
}
