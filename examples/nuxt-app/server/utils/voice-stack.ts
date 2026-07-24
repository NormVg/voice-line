import { fromAISDK } from "@voice-line/adapter-ai-sdk";
import type { Brain, STTProvider, TTSProvider } from "@voice-line/core";
import { sarvam } from "@voice-line/provider-sarvam";
import { streamText } from "ai";
import { createOllama } from "ai-sdk-ollama";

export interface VoiceStack {
  stt: STTProvider;
  tts: TTSProvider;
  brain: Brain;
  ready: { stt: boolean; tts: boolean; brain: boolean };
  warnings: string[];
}

/**
 * Build STT + TTS + Brain from runtime env.
 *
 * Brain: Ollama Cloud via `ai-sdk-ollama` + app's `ai@7` streamText
 * STT/TTS: Sarvam Saaras + Bulbul
 *
 * Important: we inject `streamText` from this app so we never pick up
 * a nested AI SDK v4 from `@voice-line/adapter-ai-sdk` (Ollama models need v7).
 */
export function createVoiceStack(env: {
  sarvamApiKey: string;
  ollamaApiKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
}): VoiceStack {
  const warnings: string[] = [];
  const ready = { stt: false, tts: false, brain: false };

  if (!env.sarvamApiKey) {
    warnings.push("SARVAM_API_KEY missing — STT/TTS will fail until set.");
  } else {
    ready.stt = true;
    ready.tts = true;
  }

  if (!env.ollamaApiKey) {
    warnings.push("OLLAMA_API_KEY missing — brain will use a local echo fallback.");
  } else {
    ready.brain = true;
  }

  const stt = sarvam.stt({
    apiKey: env.sarvamApiKey || undefined,
    language: "unknown",
    model: "saaras:v3",
    mode: "transcribe",
    streaming: true,
  });

  const tts = sarvam.tts({
    apiKey: env.sarvamApiKey || undefined,
    voice: "shubh",
    language: "en-IN",
    model: "bulbul:v3",
    sampleRate: 16_000,
  });

  let brain: Brain;

  if (env.ollamaApiKey) {
    const ollama = createOllama({
      apiKey: env.ollamaApiKey,
      baseURL: env.ollamaBaseUrl || "https://ollama.com",
    });

    const modelName = env.ollamaModel || "gemma4:31b-cloud";

    brain = fromAISDK({
      model: ollama(modelName),
      system: [
        "You are a helpful voice assistant.",
        "Keep answers short and conversational — ideally 1–3 sentences.",
        "Do not use markdown, bullet lists, or code blocks unless asked.",
        "Speak naturally; the user is listening, not reading.",
      ].join(" "),
      temperature: 0.7,
      // Force AI SDK 7 from this app (not nested v4 under adapter-ai-sdk)
      streamText: (opts) =>
        streamText({
          model: opts.model as Parameters<typeof streamText>[0]["model"],
          system: opts.system as string | undefined,
          messages: opts.messages as Parameters<typeof streamText>[0]["messages"],
          temperature: opts.temperature as number | undefined,
          abortSignal: opts.abortSignal as AbortSignal | undefined,
          tools: opts.tools as Parameters<typeof streamText>[0]["tools"],
        }) as unknown as { textStream: AsyncIterable<string> },
    });
  } else {
    brain = async function* echoBrain(userText: string) {
      yield `You said: ${userText}. `;
      yield "Set OLLAMA_API_KEY to enable the Ollama Cloud brain.";
    };
  }

  return { stt, tts, brain, ready, warnings };
}
