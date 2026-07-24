import type { VoiceLineServerConfig } from "./config.js";
import { createServer } from "./server.js";

/**
 * Nuxt / Nitro event handler factory.
 *
 * ```ts
 * // server/api/voice.post.ts
 * export default createEventHandler({ transport, stt, tts, brain })
 * ```
 *
 * Compatible with h3's event handler signature without importing h3
 * (duck-typed to avoid a hard dependency).
 */
export function createEventHandler(config: VoiceLineServerConfig) {
  const server = createServer(config);

  return async (event: {
    node?: { req?: { method?: string } };
    method?: string;
    // h3 readBody is injected by the host; we accept a pre-parsed body via context
    context?: { body?: { sessionId?: string } };
  }) => {
    try {
      const body = event.context?.body ?? null;
      const session = await server.createSession(body?.sessionId);
      return { sessionId: session.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      config.onError?.(err instanceof Error ? err : new Error(message));
      throw err;
    }
  };
}

export { createServer } from "./server.js";
export { dualBrain } from "./dual-brain.js";
export type { DualBrainOptions, HandoffDecision, HandoffFn, HandoffMode } from "./dual-brain.js";
export type { VoiceLineServerConfig } from "./config.js";
