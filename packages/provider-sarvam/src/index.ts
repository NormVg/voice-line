import type { STTProvider, TTSProvider } from "@voice-line/core";
import { SarvamSTTProvider, type SarvamSTTOptions } from "./stt.js";
import { SarvamTTSProvider, type SarvamTTSOptions } from "./tts.js";

export { SarvamSTTProvider, SarvamSTTStream } from "./stt.js";
export type { SarvamSTTOptions } from "./stt.js";
export { SarvamTTSProvider } from "./tts.js";
export type { SarvamTTSOptions } from "./tts.js";
export type { SarvamCredentials } from "./shared.js";

export interface SarvamFactory {
  stt(options?: SarvamSTTOptions): STTProvider;
  tts(options?: SarvamTTSOptions): TTSProvider;
}

/**
 * Factory matching project.md:
 *
 * ```ts
 * stt: sarvam.stt({ language: 'en-IN' })
 * tts: sarvam.tts({ voice: 'shubh' })
 * ```
 */
export const sarvam: SarvamFactory = {
  stt(options = {}) {
    return new SarvamSTTProvider(options);
  },
  tts(options = {}) {
    return new SarvamTTSProvider(options);
  },
};
