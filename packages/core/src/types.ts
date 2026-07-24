/** PCM / compressed audio formats supported on the wire. */
export type AudioFormat = "pcm16" | "opus";

/** A binary audio frame moving through the pipeline or transport. */
export interface AudioChunk {
  data: ArrayBuffer;
  sampleRate: number;
  format: AudioFormat;
}

/** Result from an STT provider. */
export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  language: string;
  confidence: number;
}

/** A single turn in the conversation history. */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  /** True if the assistant was interrupted mid-response. */
  partial: boolean;
}

/** Session state machine states. */
export type SessionState =
  | "idle"
  | "connected"
  | "listening"
  | "receiving"
  | "processing"
  | "speaking"
  | "closed";

/** Transport connection states. */
export type TransportState = "idle" | "connecting" | "connected" | "disconnected";

/** Client-facing session states (mirrors server, minus internal idle/connected). */
export type ClientState =
  | "idle"
  | "connecting"
  | "listening"
  | "receiving"
  | "processing"
  | "speaking";

export type Unsubscribe = () => void;

/** Shared audio configuration defaults. */
export interface AudioConfig {
  sampleRate: number;
  audioFormat: AudioFormat;
  chunkDurationMs: number;
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16_000,
  audioFormat: "pcm16",
  chunkDurationMs: 100,
};

/** VAD configuration. */
export interface VADConfig {
  /** Speech probability / energy threshold (0–1). Default 0.7. */
  confidence: number;
  /** Silence duration before speech_end (ms). Default 500. */
  silenceMs: number;
  /** Minimum speech duration to accept (ms). Default 200. */
  minSpeechMs: number;
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  confidence: 0.7,
  silenceMs: 500,
  minSpeechMs: 200,
};

/** Sentence chunker configuration. */
export interface ChunkerConfig {
  maxChars: number;
  flushOnPunctuation: boolean;
}

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  maxChars: 150,
  flushOnPunctuation: true,
};

/** Session lifecycle configuration. */
export interface SessionConfig {
  maxDurationMs: number;
  idleTimeoutMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxDurationMs: 1_800_000,
  idleTimeoutMs: 60_000,
};

/** STT stream configuration. */
export interface STTConfig {
  language?: string;
  sampleRate?: number;
  encoding?: "pcm_s16le" | "wav" | "pcm_raw";
  model?: string;
  metadata?: Record<string, unknown>;
}

/** TTS synthesis configuration. */
export interface TTSConfig {
  voice?: string;
  language?: string;
  sampleRate?: number;
  format?: AudioFormat;
  model?: string;
  pace?: number;
  metadata?: Record<string, unknown>;
}
