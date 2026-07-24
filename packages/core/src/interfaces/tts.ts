import type { AudioChunk, TTSConfig } from "../types.js";

/**
 * Text-to-speech provider. Synthesize text into a stream of audio chunks.
 * Call `abort()` to cancel in-flight synthesis on interruption.
 */
export interface TTSProvider {
  synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk>;
  abort(): void;
}
