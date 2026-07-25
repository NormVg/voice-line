import { createNitroWebSocketHandler, nitroToWs } from '@voice-line/server/nitro';

import { fromWebSocket } from '@voice-line/transport-ws';

import { sarvam } from '@voice-line/provider-sarvam';

import { fromAISDK } from '@voice-line/adapter-ai-sdk';

import { createOllama } from 'ai-sdk-ollama';

import { streamText } from 'ai';


// This handles the WebSocket upgrade directly within Nuxt Nitro
export default defineWebSocketHandler(

  createNitroWebSocketHandler((peer: any, url, wsListeners) => {
    const config = useRuntimeConfig();
    const hasOllama = !!config.ollamaApiKey;
    let brain;

    if (hasOllama) {
      const ollama = createOllama({
        apiKey: String(config.ollamaApiKey),
        baseURL: String(config.ollamaBaseUrl || 'https://ollama.com'),
      });
      brain = fromAISDK({
        model: ollama('gpt-oss:20b-cloud'),
        system: `You are the voice of 'voice-line', a high-performance, real-time voice layer for AI agents.
You are speaking to a developer who is testing this showcase application.
Keep your responses extremely concise (1-2 sentences maximum).
Never use markdown or lists.
Speak in a confident, direct, and slightly technical tone.`,
        // Force AI SDK 7 from this app
        streamText: (opts) =>
          streamText({
            model: opts.model,
            system: opts.system,
            messages: opts.messages ?? [],
            temperature: opts.temperature,
            abortSignal: opts.abortSignal,
            tools: opts.tools,
          } as any) as unknown as { textStream: AsyncIterable<string> },
      });
    } else {
      brain = async function* echoBrain(userText: string) {
        yield `Echoing: ${userText}. Set OLLAMA_API_KEY to enable AI.`;
      };
    }

    return {
      transport: fromWebSocket(nitroToWs(peer, wsListeners)),
      stt: sarvam.stt({
        apiKey: config.sarvamApiKey || undefined,
        language: 'en-IN',
        mode: 'transcribe',
        streaming: true
      }),
      tts: sarvam.tts({ apiKey: config.sarvamApiKey || undefined, voice: 'anushka' }),
      brain,
      chunker: {
        maxChars: 120, // slightly shorter for snappy response
      },
      sttConfig: {
        language: "en-IN",
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
      },
      onSessionStart: (session: any) => {
        console.log(`[voice-line] Started WS session: ${session.id}`);
      },
      onError: (err: any, session: any) => {
        console.error(`[voice-line ${session?.id}]`, err.message);
      },
    };
  })
);
