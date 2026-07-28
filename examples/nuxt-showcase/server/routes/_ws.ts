import { createNitroWebSocketHandler, nitroToWs } from '@voice-line/server/nitro';
import { fromWebSocket } from '@voice-line/transport-ws';
import { sarvam } from '@voice-line/provider-sarvam';
import { fromAISDK } from '@voice-line/adapter-ai-sdk';
import { createOllama } from 'ai-sdk-ollama';
import { streamText } from 'ai';

/**
 * Shared providers across peers — safe because barge-in uses per-turn
 * AbortSignal (not provider-global abort).
 */
let sharedStt: ReturnType<typeof sarvam.stt> | null = null;
let sharedTts: ReturnType<typeof sarvam.tts> | null = null;

function getProviders(apiKey: string | undefined) {
  if (!sharedStt) {
    sharedStt = sarvam.stt({
      apiKey: apiKey || undefined,
      language: 'en-IN',
      mode: 'transcribe',
      streaming: true,
    });
  }
  if (!sharedTts) {
    sharedTts = sarvam.tts({
      apiKey: apiKey || undefined,
      voice: 'anushka',
    });
  }
  return { stt: sharedStt, tts: sharedTts };
}

export default defineWebSocketHandler(
  createNitroWebSocketHandler((peer: any, _url, wsListeners) => {
    const config = useRuntimeConfig();
    const hasOllama = !!config.ollamaApiKey;
    const { stt, tts } = getProviders(config.sarvamApiKey as string | undefined);

    let brain;
    if (hasOllama) {
      const ollama = createOllama({
        apiKey: String(config.ollamaApiKey),
        baseURL: String(config.ollamaBaseUrl || 'https://ollama.com'),
      });
      brain = fromAISDK({
        model: ollama(String(config.ollamaModel || 'gpt-oss:20b-cloud')),
        system: `You are the voice of 'voice-line', a high-performance, real-time voice layer for AI agents.
You are speaking to a developer who is testing this showcase application.
Keep your responses extremely concise (1-2 sentences maximum).
Never use markdown or lists.
Speak in a confident, direct, and slightly technical tone.
If the user interrupts you, answer the new question — do not continue the previous monologue.`,
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
      transport: fromWebSocket(nitroToWs(peer, wsListeners), {
        // Drop outbound audio if the client is too slow (~256KB default).
        maxBufferedBytes: 256 * 1024,
      }),
      stt,
      tts,
      brain,
      maxSessions: 20,
      chunker: {
        maxChars: 80, // snappier first TTS chunk
        flushOnPunctuation: true,
      },
      sttConfig: {
        language: 'en-IN',
        sampleRate: 16_000,
        encoding: 'pcm_s16le',
        model: 'saaras:v3',
      },
      ttsConfig: {
        voice: 'shubh',
        language: 'en-IN',
        sampleRate: 16_000,
        format: 'pcm16',
        model: 'bulbul:v3',
      },
      vad: {
        confidence: 0.35,
        silenceMs: 500,
        minSpeechMs: 200,
      },
      session: {
        maxDurationMs: 30 * 60 * 1000,
        idleTimeoutMs: 5 * 60 * 1000,
        bargeIn: 'interrupt',
      },
      onSessionStart: (session: any) => {
        console.log(
          `[voice-line] session ${session.id} live (showcase)`,
        );
      },
      onSessionEnd: (session: any) => {
        console.log(`[voice-line] session ${session.id} ended`);
      },
      onError: (err: any, session: any) => {
        console.error(`[voice-line ${session?.id}]`, err.message);
      },
    };
  }),
);
