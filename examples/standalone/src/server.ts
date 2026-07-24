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
import { Session } from "@voice-line/core";
import { fromWebSocket } from "@voice-line/transport-ws";
import { WebSocketServer } from "ws";
import { DemoSTT, DemoTTS } from "./mock-providers.js";

const PORT = Number(process.env.PORT ?? 3001);

const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1" });

console.log(`[voice-line] listening on ws://127.0.0.1:${PORT}`);

wss.on("connection", async (socket, req) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const sessionId = url.searchParams.get("session") ?? undefined;
  console.log(`[voice-line] client connected${sessionId ? ` session=${sessionId}` : ""}`);

  let session: Session | undefined;

  const transport = fromWebSocket(socket, {
    onClose: () => {
      console.log(`[voice-line] client disconnected ${session?.id ?? ""}`);
      void session?.close();
    },
  });

  session = new Session({
    id: sessionId,
    transport,
    stt: new DemoSTT(),
    tts: new DemoTTS(),
    brain: async function* (userText, ctx) {
      console.log(`[brain] user: ${userText} (history=${ctx.history.length})`);
      yield `Got it — you said “${userText}”. `;
      yield "This is the standalone demo brain (no LLM).";
    },
    session: {
      maxDurationMs: 30 * 60 * 1000,
      idleTimeoutMs: 5 * 60 * 1000,
    },
    onStateChange: (state, prev) => {
      console.log(`[session ${session?.id}] ${prev} → ${state}`);
    },
    onError: (err) => {
      console.error(`[session ${session?.id}] error:`, err.message);
    },
  });

  await session.start();
});

process.on("SIGINT", () => {
  console.log("\n[voice-line] shutting down");
  wss.close();
  process.exit(0);
});
