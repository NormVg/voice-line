import { createTTSHandler } from "@voice-line/server/nitro";
import { createVoiceStack } from "../utils/voice-stack";

// We create a factory so it initializes inside the Nitro request context
function getHandler() {
  const config = useRuntimeConfig();
  const stack = createVoiceStack({
    sarvamApiKey: String(config.sarvamApiKey || ""),
    ollamaApiKey: String(config.ollamaApiKey || ""),
    ollamaBaseUrl: String(config.ollamaBaseUrl || "https://ollama.com"),
    ollamaModel: String(config.ollamaModel || "gemma4:31b-cloud"),
  });

  return createTTSHandler({
    tts: stack.tts,
    defaultConfig: {
      voice: "shubh",
      language: "en-IN",
      sampleRate: 16_000,
      format: "pcm16",
      model: "bulbul:v3",
    },
  });
}

// Wrapping it in defineEventHandler so we can instantiate the stack per-request or cache it
export default defineEventHandler(async (event) => {
  event.context.body = await readBody(event).catch(() => ({}));
  const handler = getHandler();
  return handler(event);
});
