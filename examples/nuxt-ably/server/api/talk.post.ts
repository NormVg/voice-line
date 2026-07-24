import { createStatelessHandler } from "@voice-line/server/nitro";
import { createVoiceStack } from "../utils/voice-stack";

function getHandler() {
  const config = useRuntimeConfig();
  const stack = createVoiceStack({
    sarvamApiKey: String(config.sarvamApiKey || ""),
    ollamaApiKey: String(config.ollamaApiKey || ""),
    ollamaBaseUrl: String(config.ollamaBaseUrl || "https://ollama.com"),
    ollamaModel: String(config.ollamaModel || "gemma4:31b-cloud"),
  });

  return createStatelessHandler({
    stt: stack.stt,
    tts: stack.tts,
    brain: stack.brain,
    sttConfig: {
      language: "unknown",
      sampleRate: 16_000,
      encoding: "pcm_s16le",
      model: "saaras:v3",
    },
    ttsConfig: {
      voice: "shubh",
      language: "en-IN",
      sampleRate: 16_000,
      format: "pcm16",
      model: "bulbul:v3",
    },
  });
}

export default defineEventHandler(async (event: any) => {
  // readRawBody reads the binary Buffer from the request in Nitro
  const rawBody = await readRawBody(event, false);
  event.context.rawBody = rawBody; // createStatelessHandler expects this in context

  const handler = getHandler();
  return handler(event);
});
