import { createEventHandler } from "@voice-line/server/nitro";
import { ably } from "@voice-line/transport-ably";
import { createVoiceStack } from "../utils/voice-stack";

// Cache the stack globally to avoid recreating it on every connection
let globalStack: ReturnType<typeof createVoiceStack> | null = null;

function getStack(config: ReturnType<typeof useRuntimeConfig>) {
  if (globalStack) return globalStack;
  globalStack = createVoiceStack({
    sarvamApiKey: String(config.sarvamApiKey || ""),
    ollamaApiKey: String(config.ollamaApiKey || ""),
    ollamaBaseUrl: String(config.ollamaBaseUrl || "https://ollama.com"),
    ollamaModel: String(config.ollamaModel || "gemma4:31b-cloud"),
  });
  return globalStack;
}

// createEventHandler returns a handler compatible with h3
export default defineEventHandler(
  createEventHandler(async (event: any) => {
    const config = useRuntimeConfig();
    const ablyApiKey = config.ablyApiKey as string;

    if (!ablyApiKey) {
      throw createError({
        statusCode: 500,
        statusMessage: "ABLY_API_KEY is not configured on the server.",
      });
    }

    // Parse the body to read custom VAD options sent by the client
    const body = await readBody(event).catch(() => ({}));
    const stack = getStack(config);

    // Return the dynamic configuration for this session
    return {
      transport: ably({ apiKey: ablyApiKey }),
      stt: stack.stt,
      tts: stack.tts,
      brain: stack.brain,
      // Shared createServer path — SessionManager enforces this.
      maxSessions: 20,
      chunker: {
        maxChars: 80,
        flushOnPunctuation: true,
      },
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
      // Keep dynamic VAD configuration driven by the client request!
      vad: {
        confidence: Number(body.vad?.confidence ?? 0.3),
        silenceMs: Number(body.vad?.silenceMs ?? 1000),
        minSpeechMs: Number(body.vad?.minSpeechMs ?? 200),
      },
      session: {
        maxDurationMs: 30 * 60 * 1000, // 30 mins
        idleTimeoutMs: 5 * 60 * 1000, // 5 mins
        bargeIn: "interrupt",
      },
      onSessionStart: (session: any) => {
        console.log(`[voice-line] ably session ${session.id} started`);
      },
      onSessionEnd: (session: any) => {
        console.log(`[voice-line] ably session ${session.id} ended`);
      },
      onError: (err: any, session: any) => {
        console.error(`[voice-line ${session?.id ?? "session"}]`, err.message);
      },
    };
  })
);
