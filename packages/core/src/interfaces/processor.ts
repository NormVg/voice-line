/**
 * Pipeline frames — the unit of data flowing through processors.
 * Processors transform frames; they never talk to transports or brains directly.
 */

export type Frame =
  | AudioFrame
  | SpeechStartFrame
  | SpeechEndFrame
  | TranscriptFrame
  | TextFrame
  | SentenceFrame
  | FlushFrame
  | ErrorFrame;

export interface AudioFrame {
  kind: "audio";
  data: ArrayBuffer;
  sampleRate: number;
}

export interface SpeechStartFrame {
  kind: "speech_start";
}

export interface SpeechEndFrame {
  kind: "speech_end";
  /** Buffered utterance audio when available. */
  audio?: ArrayBuffer;
  sampleRate?: number;
}

export interface TranscriptFrame {
  kind: "transcript";
  text: string;
  isFinal: boolean;
  language?: string;
  confidence?: number;
}

export interface TextFrame {
  kind: "text";
  text: string;
}

export interface SentenceFrame {
  kind: "sentence";
  text: string;
}

export interface FlushFrame {
  kind: "flush";
}

export interface ErrorFrame {
  kind: "error";
  error: Error;
}

export type ProcessResult = Frame | Frame[] | null | undefined | Promise<Frame | Frame[] | null | undefined>;

/**
 * A single stage in a Pipeline. Receives a frame, optionally emits zero or more frames.
 */
export interface Processor {
  readonly name: string;
  process(frame: Frame): ProcessResult;
  /** Called when the pipeline is flushed (interruption / session end). */
  reset?(): void;
  destroy?(): void | Promise<void>;
}
