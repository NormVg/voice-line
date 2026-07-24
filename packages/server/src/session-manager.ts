import { createId, Session, type SessionOptions, type Transport } from "@voice-line/core";
import type { VoiceLineServerConfig } from "./config.js";

/**
 * Creates and tracks live Sessions.
 * Owns lifecycle hooks and cleanup — not the domain state machine (Session does).
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly config: VoiceLineServerConfig;

  constructor(config: VoiceLineServerConfig) {
    this.config = config;
  }

  get size(): number {
    return this.sessions.size;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  async create(sessionId?: string): Promise<{ session: Session; clientPayload?: Record<string, unknown> }> {
    const id = sessionId ?? createId("ses");
    if (this.sessions.has(id)) {
      throw new Error(`Session already exists: ${id}`);
    }

    const { transport, clientPayload } = await resolveTransport(this.config.transport, id);

    // Build options without explicit `undefined` fields (exactOptionalPropertyTypes).
    const options: SessionOptions = {
      id,
      transport,
      stt: this.config.stt,
      tts: this.config.tts,
      brain: this.config.brain,
      onError: (error) => this.config.onError?.(error, this.sessions.get(id)),
      onStateChange: (state) => {
        if (state === "closed") {
          const closed = this.sessions.get(id);
          this.sessions.delete(id);
          if (closed) this.config.onSessionEnd?.(closed);
        }
      },
    };
    if (this.config.audio) options.audio = this.config.audio;
    if (this.config.vad) options.vad = this.config.vad;
    if (this.config.chunker) options.chunker = this.config.chunker;
    if (this.config.session) options.session = this.config.session;
    if (this.config.sttConfig) options.sttConfig = this.config.sttConfig;
    if (this.config.ttsConfig) options.ttsConfig = this.config.ttsConfig;

    const session = new Session(options);

    this.sessions.set(id, session);
    await session.start();
    this.config.onSessionStart?.(session);
    
    if (clientPayload !== undefined) {
      return { session, clientPayload };
    }
    return { session };
  }

  async destroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.close();
    this.sessions.delete(sessionId);
  }

  async destroyAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((s) => s.close()));
  }
}

async function resolveTransport(
  transport: VoiceLineServerConfig["transport"],
  sessionId: string,
): Promise<{ transport: Transport; clientPayload?: Record<string, unknown> }> {
  if (typeof transport === "function") {
    const result = await transport(sessionId);
    // Transport has a 'connect' method. TransportFactoryResult has a 'transport' property.
    if ("transport" in result) {
      return result as { transport: Transport; clientPayload?: Record<string, unknown> };
    }
    return { transport: result };
  }
  return { transport };
}
