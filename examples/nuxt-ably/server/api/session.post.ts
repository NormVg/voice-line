import { AblyTransport } from "@voice-line/transport-ably";
import { Session } from "@voice-line/core";
import { createVoiceStack } from "../utils/voice-stack";
import { sessionStore } from "../utils/session-store";
import Ably from "ably";

// Cache the stack globally to avoid recreating it on every connection
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
  return globalStack;
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const ablyApiKey = config.ablyApiKey as string;
  const body = await readBody(event).catch(() => ({}));

  if (!ablyApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: "ABLY_API_KEY is not configured on the server.",
    });
  }

  // 1. Generate a new session ID
  const sessionId = "ses_" + Math.random().toString(36).substring(2, 9);
  const channelName = `voice-line:${sessionId}`;

  // 2. Generate an Ably token request for the client, scoped to this session's channel
  const restClient = new Ably.Rest(ablyApiKey);
  const tokenRequest = await restClient.auth.createTokenRequest({
    clientId: `client_${sessionId}`,
    capability: {
      [channelName]: ["publish", "subscribe", "presence"],
    },
  });

  // 3. Build the server session (but DON'T start it yet)
  const stack = getStack();

  const transport = new AblyTransport({
    role: "server",
    apiKey: ablyApiKey,
    channelName: () => channelName,
    Realtime: Ably.Realtime,
  });

  const session = new Session({
    id: sessionId,
    transport,
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
    vad: {
      confidence: Number(body.vad?.confidence ?? 0.3),
      silenceMs: Number(body.vad?.silenceMs ?? 1000),
      minSpeechMs: Number(body.vad?.minSpeechMs ?? 200),
    },
    session: {
      maxDurationMs: 30 * 60 * 1000,
      idleTimeoutMs: 5 * 60 * 1000,
      bargeIn: "interrupt",
    },
    onStateChange: (state, prev) => {
      console.log(`[session ${session.id}] ${prev} → ${state}`);
      if (state === "closed") {
        sessionStore.delete(session.id);
      }
    },
    onError: (err) => {
      console.error(`[session ${session.id}]`, err.message);
    },
  });

  sessionStore.set(sessionId, session);

  // 4. Return the token to the client FIRST, then start the session.
  //    We use waitUntil / setImmediate to ensure the HTTP response is sent
  //    before the server connects to Ably and publishes session:ready.
  //    This gives the client time to connect and subscribe.
  //
  //    The client calls connect() → subscribes to event:server → sends client:ready.
  //    The server receives client:ready → calls session.ready() → state → listening.
  //    Even if session:ready is lost (it's informational), the client:ready handshake
  //    is what actually starts the conversation.
  setImmediate(() => {
    console.log(`[session.post.ts] calling session.start() for ${sessionId}...`);
    session.start().then(() => {
      console.log(`[session.post.ts] session.start() finished for ${sessionId}`);
    }).catch((err) => {
      console.error(`[session ${sessionId}] failed to start:`, err);
      sessionStore.delete(sessionId);
    });
  });

  return {
    sessionId,
    tokenRequest,
  };
});
