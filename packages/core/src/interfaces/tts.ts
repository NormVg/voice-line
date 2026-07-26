import type { AudioChunk, TTSConfig } from "../types.js";

/**
 * Text-to-speech provider. Synthesize text into a stream of audio chunks.
 *
 * Prefer `config.signal` for per-turn cancellation (safe with a shared
 * provider across sessions). `abort()` is a bulk cancel of provider-owned
 * work and must not be required for barge-in on multi-tenant servers.
 */
export interface TTSProvider {
  synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk>;
  /** Cancel provider-owned in-flight work. Prefer `TTSConfig.signal` for session barge-in. */
  abort(): void;
}
