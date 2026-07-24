import type { TTSConfig, TTSProvider } from "@voice-line/core";

export interface TTSHandlerConfig {
  tts: TTSProvider;
  defaultConfig?: TTSConfig;
}

export function createTTSHandlerBase(config: TTSHandlerConfig) {
  return async function handleTTS(text: string, overrideConfig?: TTSConfig) {
    const finalConfig = { ...config.defaultConfig, ...overrideConfig };
    const stream = config.tts.synthesize(text, finalConfig);
    return stream;
  };
}
