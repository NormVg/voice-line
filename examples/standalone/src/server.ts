/**
 * Minimal voice-line WebSocket server.
 *
 *   pnpm --filter @voice-line/example-standalone start
 *
 * Then in another terminal:
 *
 *   pnpm --filter @voice-line/example-standalone client
 *
 * Or connect any client with WsTransport to ws://127.0.0.1:3001
 */
import { createServer } from "@voice-line/server";
import { fromWebSocket } from "@voice-line/transport-ws";
import { WebSocketServer } from "ws";
import { DemoSTT, DemoTTS } from "./mock-providers.js";

const PORT = Number(process.env.PORT ?? 3001);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS ?? 20);

const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1" });

/**
 * One shared SessionManager for the process so maxSessions is real.
 * Transport is resolved per connection via the factory.
 */
const pendingSockets = new Map<string, import("ws").WebSocket>();

const server = createServer({
  transport: (sessionId) => {
    const socket = pendingSockets.get(sessionId);
    if (!socket) {
      throw new Error(`No socket registered for session ${sessionId}`);
    }
    pendingSockets.delete(sessionId);
    return fromWebSocket(socket, {
      maxBufferedBytes: 256 * 1024,
      onClose: () => {
        console.log(`[voice-line] client disconnected ${sessionId}`);
        void server.getSession(sessionId)?.close().catch(() => {});
      },
    });
  },
  stt: new DemoSTT(),
  tts: new DemoTTS(),
  brain: async function* (userText, ctx) {
    console.log(`[brain] user: ${userText} (history=${ctx.history.length})`);
    yield `Got it — you said “${userText}”. `;
    yield "This is the standalone demo brain (no LLM).";
  },
  maxSessions: MAX_SESSIONS,
  chunker: { maxChars: 80, flushOnPunctuation: true },
  session: {
    maxDurationMs: 30 * 60 * 1000,
    idleTimeoutMs: 5 * 60 * 1000,
    bargeIn: "interrupt",
  },
  onSessionStart: (session) => {
    console.log(`[voice-line] session ${session.id} started (${server.sessions.size}/${MAX_SESSIONS})`);
    session.onStateChange((state, prev) => {
      console.log(`[session ${session.id}] ${prev} → ${state}`);
    });
  },
  onSessionEnd: (session) => {
    console.log(`[voice-line] session ${session.id} ended`);
  },
  onError: (err, session) => {
    console.error(`[session ${session?.id ?? "?"}] error:`, err.message);
  },
});

console.log(`[voice-line] listening on ws://127.0.0.1:${PORT} (maxSessions=${MAX_SESSIONS})`);

wss.on("connection", async (socket, req) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const sessionId =
    url.searchParams.get("session") ?? `ses_${Math.random().toString(36).slice(2, 10)}`;

  if (server.sessions.size >= MAX_SESSIONS) {
    console.warn(`[voice-line] rejecting connection — capacity ${MAX_SESSIONS}`);
    socket.close(1013, "Session limit reached");
    return;
  }

  console.log(`[voice-line] client connected session=${sessionId}`);
  pendingSockets.set(sessionId, socket);

  try {
    await server.createSession(sessionId);
  } catch (err) {
    pendingSockets.delete(sessionId);
    console.error("[voice-line] failed to start session:", err);
    try {
      socket.close(1013, err instanceof Error ? err.message : "Failed");
    } catch {
      /* ignore */
    }
  }
});

process.on("SIGINT", () => {
  console.log("\n[voice-line] shutting down");
  void server.close().finally(() => {
    wss.close();
    process.exit(0);
  });
});
