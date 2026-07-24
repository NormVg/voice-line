import type { Session } from "@voice-line/core";
import type { VoiceLineServerConfig } from "./config.js";
import { SessionManager } from "./session-manager.js";

export interface VoiceLineServer {
  readonly sessions: SessionManager;
  /** Create and start a new session. */
  createSession(sessionId?: string): Promise<Session>;
  /** Look up a live session. */
  getSession(sessionId: string): Session | undefined;
  /** Shut down all sessions. */
  close(): Promise<void>;
}

/**
 * Create a voice-line server runtime.
 * Framework adapters (Next, Nitro) wrap this.
 */
export function createServer(config: VoiceLineServerConfig): VoiceLineServer {
  const sessions = new SessionManager(config);

  return {
    sessions,
    createSession: (sessionId) => sessions.create(sessionId),
    getSession: (sessionId) => sessions.get(sessionId),
    close: () => sessions.destroyAll(),
  };
}
