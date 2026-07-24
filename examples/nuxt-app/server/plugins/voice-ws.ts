/**
 * Long-lived WebSocket server for voice-line sessions.
 *
 * Nuxt HTTP :3000 · voice WS :3001/voice
 * Stack: Sarvam STT/TTS + Ollama Cloud (AI SDK) brain
 */
import { Session } from "@voice-line/core";
import { fromWebSocket } from "@voice-line/transport-ws";
import { WebSocketServer } from "ws";
import { createVoiceStack } from "../utils/voice-stack";

type GlobalVoice = {
  wss?: WebSocketServer;
  started?: boolean;
};

const g = globalThis as typeof globalThis & { __voiceLine?: GlobalVoice };
if (!g.__voiceLine) g.__voiceLine = {};

export default defineNitroPlugin(() => {
  if (import.meta.prerender) return;
  // Survive Nitro HMR — don't re-bind the same port
  if (g.__voiceLine.started && g.__voiceLine.wss) {
    console.log("[voice-line] WebSocket already running (HMR reuse)");
    return;
  }

  const config = useRuntimeConfig();
  const port = Number(config.voiceWsPort || 3001);
  const path = "/voice";

  const stack = createVoiceStack({
    sarvamApiKey: String(config.sarvamApiKey || ""),
    ollamaApiKey: String(config.ollamaApiKey || ""),
    ollamaBaseUrl: String(config.ollamaBaseUrl || "https://ollama.com"),
    ollamaModel: String(config.ollamaModel || "gemma4:31b-cloud"),
  });

  for (const w of stack.warnings) {
    console.warn(`[voice-line] ${w}`);
  }

  let wss: WebSocketServer;
  try {
    wss = new WebSocketServer({ port, host: "0.0.0.0", path });
  } catch (err) {
    console.error(
      `[voice-line] failed to bind WS on :${port} — set VOICE_WS_PORT to a free port`,
      err,
    );
    return;
  }

  g.__voiceLine.wss = wss;
  g.__voiceLine.started = true;

  console.log(
    `[voice-line] WebSocket listening on ws://127.0.0.1:${port}${path}`,
  );
  console.log(
    `[voice-line] ready: stt=${stack.ready.stt} tts=${stack.ready.tts} brain=${stack.ready.brain} model=${config.ollamaModel}`,
  );

  wss.on("connection", async (socket, req) => {
    const url = new URL(req.url ?? path, `http://127.0.0.1:${port}`);
    const sessionId = url.searchParams.get("session") ?? undefined;

    console.log(
      `[voice-line] client connected${sessionId ? ` session=${sessionId}` : ""}`,
    );

    let session: Session | undefined;

    const transport = fromWebSocket(socket, {
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

      await session.start();
    } catch (err) {
      console.error("[voice-line] failed to start session:", err);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
  });

  wss.on("error", (err) => {
    console.error("[voice-line] WebSocket server error:", err.message);
  });
});
