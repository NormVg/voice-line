// Types
export type {
  AudioChunk,
  AudioConfig,
  AudioFormat,
  ChunkerConfig,
  ClientState,
  Message,
  SessionConfig,
  SessionState,
  STTConfig,
  TranscriptResult,
  TransportState,
  TTSConfig,
  Unsubscribe,
  VADConfig,
} from "./types.js";

export {
  DEFAULT_AUDIO_CONFIG,
  DEFAULT_CHUNKER_CONFIG,
  DEFAULT_SESSION_CONFIG,
  DEFAULT_VAD_CONFIG,
} from "./types.js";

// Events
export type {
  AudioFlushEvent,
  BotTextDeltaEvent,
  BotTextDoneEvent,
  ClientReadyEvent,
  ClientToServerEvent,
  ErrorEvent,
  MicToggleEvent,
  ServerToClientEvent,
  SessionReadyEvent,
  StateChangeEvent,
  TextSendEvent,
  TranscriptFinalEvent,
  TranscriptPartialEvent,
  VoiceLineEvent,
} from "./events.js";

export { isClientEvent, isServerEvent } from "./events.js";

// Interfaces
export type { Transport, TransportFactory } from "./interfaces/transport.js";
export type { STTProvider, STTStream, STTStreamEventMap } from "./interfaces/stt.js";
export type { TTSProvider } from "./interfaces/tts.js";
export type { Brain, BrainContext, BrainResult } from "./interfaces/brain.js";
export { brainToStream, collectBrainStream } from "./interfaces/brain.js";
export type {
  AudioFrame,
  ErrorFrame,
  FlushFrame,
  Frame,
  ProcessResult,
  Processor,
  SentenceFrame,
  SpeechEndFrame,
  SpeechStartFrame,
  TextFrame,
  TranscriptFrame,
} from "./interfaces/processor.js";

// Pipeline
export { Pipeline } from "./pipeline/pipeline.js";
export type { PipelineListener } from "./pipeline/pipeline.js";
export { VADProcessor } from "./pipeline/vad.js";
export { SentenceChunker } from "./pipeline/chunker.js";
export { STTProcessor } from "./pipeline/stt-processor.js";
export type { TranscriptHandler } from "./pipeline/stt-processor.js";

// Session
export { Session } from "./session/session.js";
export type { SessionOptions } from "./session/session.js";
export { MessageHistory } from "./session/history.js";

// Utils
export {
  concatArrayBuffers,
  float32ToPcm16,
  pcm16ToFloat32,
  pcm16ToWav,
  resample,
  rmsEnergy,
} from "./utils/audio.js";
export { createId } from "./utils/id.js";

// Testing helpers
export { MemoryTransport, createMemoryTransportPair } from "./testing/memory-transport.js";

