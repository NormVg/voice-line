import { d as defineEventHandler, a as readRawBody, u as useRuntimeConfig } from '../../nitro/nitro.mjs';
import { createStatelessHandler } from '@voice-line/server/nitro';
import { c as createVoiceStack } from '../../_/voice-stack.mjs';
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
  return createStatelessHandler({
    stt: stack.stt,
    tts: stack.tts,
    brain: stack.brain,
    sttConfig: {
      language: "unknown",
      sampleRate: 16e3,
      encoding: "pcm_s16le",
      model: "saaras:v3"
    },
    ttsConfig: {
      voice: "shubh",
      language: "en-IN",
      sampleRate: 16e3,
      format: "pcm16",
      model: "bulbul:v3"
    }
  });
}
const talk_post = defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, false);
  event.context.rawBody = rawBody;
  const handler = getHandler();
  return handler(event);
});

export { talk_post as default };
//# sourceMappingURL=talk.post.mjs.map
