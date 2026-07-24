import { Session } from "@voice-line/core";
import { fromWebSocket } from "@voice-line/transport-ws";
import { createVoiceStack } from "../utils/voice-stack";

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

interface PeerContext {
  listeners: Record<string, Function[]>;
  session?: Session;
}
const peerContexts = new WeakMap<any, PeerContext>();

export default defineWebSocketHandler({
  open(peer) {
    const url = new URL(peer.url, "http://localhost");
    const sessionId = url.searchParams.get("session") ?? undefined;
    console.log(`[voice-line] client connected session=${sessionId ?? peer.id}`);

    const ctx: PeerContext = { listeners: {} };
    peerContexts.set(peer, ctx);

    // Provide an EventEmitter-like interface for fromWebSocket
    const listeners = ctx.listeners;
    const wsLike = {
      readyState: 1, // WS_OPEN
      send: (data: any) => peer.send(data),
      close: () => peer.close(),
      on: (event: string, listener: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(listener);
      },
      off: (event: string, listener: Function) => {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter((l) => l !== listener);
      },
      addEventListener: (type: string, listener: any) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(listener);
      },
      removeEventListener: (type: string, listener: any) => {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter((l) => l !== listener);
      },
    };

    const stack = getStack();

    let session: Session | undefined;

    const transport = fromWebSocket(wsLike as any, {
      onClose: () => {
        console.log(`[voice-line] client disconnected ${session?.id ?? ""}`);
        void session?.close();
      },
      onError: (err) => {
        console.error(`[voice-line] transport error:`, err.message);
      },
    });

    try {
      session = new Session({
        id: sessionId ?? peer.id,
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
          confidence: 0.35,
          silenceMs: 500,
          minSpeechMs: 200,
        },
        session: {
          maxDurationMs: 30 * 60 * 1000,
          idleTimeoutMs: 5 * 60 * 1000,
        },
        onStateChange: (state, prev) => {
          console.log(`[session ${session?.id}] ${prev} → ${state}`);
        },
        onError: (err) => {
          console.error(`[session ${session?.id}]`, err.message);
        },
      });

      session.start().catch((err) => {
        console.error("[voice-line] failed to start session:", err);
        peer.close();
      });
      ctx.session = session;
    } catch (err) {
      console.error("[voice-line] failed to initialize session:", err);
      peer.close();
    }
  },

  message(peer, message) {
    const isBinary = typeof message.rawData !== "string";
    const data = isBinary ? message.arrayBuffer() : message.text();

    const ctx = peerContexts.get(peer);
    const listeners = ctx?.listeners?.message || [];
    listeners.forEach((l: any) => {
      // attachSocket uses addEventListener if present, so it expects { data }
      l({ data });
    });
  },

  close(peer) {
    const ctx = peerContexts.get(peer);
    const listeners = ctx?.listeners?.close || [];
    listeners.forEach((l: any) => l());
    const session = ctx?.session;
    void session?.close();
  },

  error(peer, error) {
    const ctx = peerContexts.get(peer);
    const listeners = ctx?.listeners?.error || [];
    listeners.forEach((l: any) => l(error));
  },
});
