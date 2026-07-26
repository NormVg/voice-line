import type {
  AudioConfig,
  Brain,
  ChunkerConfig,
  SessionConfig,
  STTConfig,
  STTProvider,
  Transport,
  TTSConfig,
  TTSProvider,
  VADConfig,
} from "@voice-line/core";
import type { Session } from "@voice-line/core";

/**
 * Server configuration. Concrete transports/providers are injected —
 * server never imports their packages.
 */
export interface VoiceLineServerConfig {
  transport: 
    | Transport 
    | ((sessionId: string) => 
        | Transport 
        | Promise<Transport> 
        | { transport: Transport; clientPayload?: Record<string, unknown> }
        | Promise<{ transport: Transport; clientPayload?: Record<string, unknown> }>
      );
  stt: STTProvider;
  tts: TTSProvider;
  brain: Brain;

  audio?: Partial<AudioConfig>;
  sttConfig?: STTConfig;
  ttsConfig?: TTSConfig;
  vad?: Partial<VADConfig>;
  chunker?: Partial<ChunkerConfig>;
  session?: Partial<SessionConfig>;

  /**
   * Max concurrent live sessions for this server instance.
   * Further create() calls throw VoiceLineError ERR_CAPACITY.
   * Default: 100. Set 0 for unlimited (not recommended in production).
   */
  maxSessions?: number;

  onSessionStart?: (session: Session) => void;
  onSessionEnd?: (session: Session) => void;
  onError?: (error: Error, session?: Session) => void;
}

/** Default concurrent session cap when `maxSessions` is omitted. */
export const DEFAULT_MAX_SESSIONS = 100;
