/**
 * CLI client for the standalone demo server.
 *
 * Sends a text turn and prints server events + audio chunk sizes.
 */
import type { VoiceLineEvent } from "@voice-line/core";
import { WsTransport } from "@voice-line/transport-ws";
import WebSocket from "ws";

const URL = process.env.VOICE_URL ?? "ws://127.0.0.1:3001";
const text =
  process.argv
    .slice(2)
    .filter((a) => a !== "--")
    .join(" ")
    .trim() || "Hello voice-line";

const transport = new WsTransport({
  url: URL,
  WebSocketImpl: WebSocket as unknown as new (
    url: string,
    protocols?: string | string[],
  ) => WebSocket,
});

let audioBytes = 0;

transport.onEvent((event: VoiceLineEvent) => {
  switch (event.type) {
    case "session:ready":
      console.log(`[event] session ready: ${event.sessionId}`);
      break;
    case "state:change":
      console.log(`[event] state → ${event.state}`);
      break;
    case "bot:text:delta":
      process.stdout.write(event.delta);
      break;
    case "bot:text:done":
      console.log(`\n[event] bot done (partial=${event.partial}): ${event.text}`);
      break;
    case "transcript:final":
      console.log(`[event] user transcript: ${event.text}`);
      break;
    case "audio:flush":
      console.log("[event] audio flush");
      break;
    case "error":
      console.error(`[event] error: ${event.error.message}`);
      break;
    default:
      console.log(`[event] ${event.type}`);
  }
});

transport.onAudio((chunk) => {
  audioBytes += chunk.byteLength;
});

await transport.connect("cli");
console.log(`[client] connected to ${URL}`);

transport.sendEvent({
  type: "client:ready",
  capabilities: { audio: true, sampleRate: 16000 },
});

// Give the session a tick to enter listening
await new Promise((r) => setTimeout(r, 50));

console.log(`[client] sending text: ${text}`);
transport.sendEvent({ type: "text:send", text });

// Wait for bot:text:done
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("timed out waiting for bot response")), 10_000);
  const unsub = transport.onEvent((e) => {
    if (e.type === "bot:text:done") {
      clearTimeout(timeout);
      unsub();
      resolve();
    }
  });
});

// allow trailing audio
await new Promise((r) => setTimeout(r, 100));

console.log(`[client] received ${audioBytes} bytes of audio`);
await transport.disconnect();
console.log("[client] done");
