import { createNitroWebSocketHandler, nitroToWs } from "@voice-line/server/nitro";
import { fromWebSocket } from "@voice-line/transport-ws";
import { createVoiceStack } from "../utils/voice-stack";

// Cache the stack globally — shared STT/TTS is multi-session safe
// (barge-in uses per-turn AbortSignal, not provider-global abort).
let globalStack: ReturnType<typeof createVoiceStack> | null = null;

function getStack() {
  if (globalStack) return globalStack;
  const config = useRuntimeConfig();
  globalStack = createVoiceStack({
    sarvamApiKey: String(config.sarvamApiKey || ""),
    ollamaApiKey: String(config.ollamaApiKey || ""),
    ollamaBaseUrl: String(config.ollamaBaseUrl || "https://ollama.com"),
    ollamaModel: String(config.ollamaModel || "gemma4:31b-cloud"),
  });
  if (globalStack.warnings.length) {
    for (const w of globalStack.warnings) console.warn(`[voice-line] ${w}`);
  }
  return globalStack;
}

export default defineWebSocketHandler(
  createNitroWebSocketHandler((peer: any, _url, wsListeners) => {
    const stack = getStack();

    return {
      transport: fromWebSocket(nitroToWs(peer, wsListeners), {
        maxBufferedBytes: 256 * 1024,
      }),
      stt: stack.stt,
      tts: stack.tts,
      brain: stack.brain,
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
      vad: {
        confidence: 0.35,
        silenceMs: 500,
        minSpeechMs: 200,
      },
      session: {
        maxDurationMs: 30 * 60 * 1000,
        idleTimeoutMs: 5 * 60 * 1000,
        bargeIn: "interrupt",
      },
      onSessionStart: (session: any) => {
        console.log(`[voice-line] session ${session.id} started`);
        session.onStateChange((state: string, prev: string) => {
          console.log(`[voice-line ${session.id}] ${prev} → ${state}`);
        });
      },
      onSessionEnd: (session: any) => {
        console.log(`[voice-line] session ${session.id} ended`);
      },
      onError: (err: any, session: any) => {
        console.error(`[voice-line ${session?.id}]`, err.message ?? err);
      },
    };
  }),
);
