import { d as defineEventHandler, r as readBody, u as useRuntimeConfig } from '../../nitro/nitro.mjs';
import { a as createVoiceStack, d as createTTSHandler } from '../../_/voice-stack.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'ai';
import 'ai-sdk-ollama';

function getHandler() {
  const config = useRuntimeConfig();
  const stack = createVoiceStack({
    sarvamApiKey: String(config.sarvamApiKey || ""),
    ollamaApiKey: String(config.ollamaApiKey || ""),
    ollamaBaseUrl: String(config.ollamaBaseUrl || "https://ollama.com"),
    ollamaModel: String(config.ollamaModel || "gemma4:31b-cloud")
  });
  return createTTSHandler({
    tts: stack.tts,
    defaultConfig: {
      voice: "shubh",
      language: "en-IN",
      sampleRate: 16e3,
      format: "pcm16",
      model: "bulbul:v3"
    }
  });
}
const tts_post = defineEventHandler(async (event) => {
  event.context.body = await readBody(event).catch(() => ({}));
  const handler = getHandler();
  return handler(event);
});

export { tts_post as default };
//# sourceMappingURL=tts.post.mjs.map
