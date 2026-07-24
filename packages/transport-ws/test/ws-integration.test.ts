import {
  Session,
  type ServerToClientEvent,
  type VoiceLineEvent,
} from "@voice-line/core";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { fromWebSocket } from "../src/from-websocket.js";
import { WsTransport } from "../src/ws.js";
import {
  makeSilencePcm,
  makeSpeechPcm,
  MockSTT,
  MockTTS,
  waitFor,
} from "./helpers.js";

type WsCtor = new (url: string, protocols?: string | string[]) => WebSocket;

const WS = WebSocket as unknown as WsCtor;

const OPEN_PORTS: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (OPEN_PORTS.length > 0) {
    const s = OPEN_PORTS.pop();
    await s?.close();
  }
}, 15_000);

async function listen(): Promise<{
  port: number;
  wss: WebSocketServer;
  close: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const addr = wss.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const port = addr.port;

  const close = async () => {
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve, reject) => {
      wss.close((err) => (err ? reject(err) : resolve()));
    });
  };
  OPEN_PORTS.push({ close });
  return { port, wss, close };
}

describe("WebSocket transport integration", () => {
  it("exchanges events client ↔ server over real sockets", async () => {
    const { port, wss } = await listen();

    const serverEvents: VoiceLineEvent[] = [];
    const clientEvents: VoiceLineEvent[] = [];

    const serverReady = new Promise<void>((resolve) => {
      wss.once("connection", (socket) => {
        const serverTransport = fromWebSocket(socket);
        void serverTransport.connect("ses_test");
        serverTransport.onEvent((e) => {
          serverEvents.push(e);
          if (e.type === "client:ready") {
            serverTransport.sendEvent({
              type: "session:ready",
              sessionId: "ses_test",
            });
            serverTransport.sendEvent({
              type: "state:change",
              state: "listening",
            });
          }
        });
        resolve();
      });
    });

    const client = new WsTransport({
      url: `ws://127.0.0.1:${port}`,
      WebSocketImpl: WS,
    });
    client.onEvent((e) => {
      clientEvents.push(e);
    });

    await client.connect("ses_test");
    await serverReady;

    client.sendEvent({
      type: "client:ready",
      capabilities: { audio: true, sampleRate: 16000 },
    });

    await waitFor(() => serverEvents.some((e) => e.type === "client:ready"));
    await waitFor(() => clientEvents.some((e) => e.type === "session:ready"));

    expect(serverEvents.map((e) => e.type)).toContain("client:ready");
    expect(clientEvents.map((e) => e.type)).toContain("session:ready");
    expect(clientEvents.map((e) => e.type)).toContain("state:change");

    await client.disconnect();
  });

  it("exchanges binary audio both ways", async () => {
    const { port, wss } = await listen();
    const serverAudio: ArrayBuffer[] = [];
    const clientAudio: ArrayBuffer[] = [];

    wss.once("connection", (socket) => {
      const serverTransport = fromWebSocket(socket);
      void serverTransport.connect("ses_audio");
      serverTransport.onAudio((chunk) => {
        serverAudio.push(chunk);
        serverTransport.sendAudio(chunk);
      });
    });

    const client = new WsTransport({
      url: `ws://127.0.0.1:${port}`,
      WebSocketImpl: WS,
    });
    client.onAudio((chunk) => {
      clientAudio.push(chunk);
    });
    await client.connect("ses_audio");

    const payload = makeSpeechPcm(50);
    client.sendAudio(payload);

    await waitFor(() => serverAudio.length >= 1 && clientAudio.length >= 1);

    expect(serverAudio[0]?.byteLength).toBe(payload.byteLength);
    expect(clientAudio[0]?.byteLength).toBe(payload.byteLength);

    await client.disconnect();
  });

  it("runs a full Session text turn over WebSocket", async () => {
    const { port, wss } = await listen();
    const tts = new MockTTS();
    let session: Session | undefined;

    wss.on("connection", (socket) => {
      const transport = fromWebSocket(socket, {
        onClose: () => {
          void session?.close();
        },
      });

      session = new Session({
        transport,
        stt: new MockSTT(),
        tts,
        brain: async function* (text) {
          yield `You said: ${text}.`;
        },
        session: { maxDurationMs: 60_000, idleTimeoutMs: 60_000 },
        vad: { confidence: 0.05, silenceMs: 200, minSpeechMs: 50 },
      });

      void session.start();
    });

    const client = new WsTransport({
      url: `ws://127.0.0.1:${port}`,
      WebSocketImpl: WS,
    });

    const events: ServerToClientEvent[] = [];
    const audioOut: ArrayBuffer[] = [];

    client.onEvent((e) => {
      events.push(e as ServerToClientEvent);
    });
    client.onAudio((chunk) => {
      audioOut.push(chunk);
    });

    await client.connect("ses_text");

    client.sendEvent({
      type: "client:ready",
      capabilities: { audio: true, sampleRate: 16000 },
    });

    await waitFor(() => events.some((e) => e.type === "session:ready"));
    await waitFor(() =>
      events.some((e) => e.type === "state:change" && e.state === "listening"),
    );

    client.sendEvent({ type: "text:send", text: "book a flight" });

    await waitFor(() => events.some((e) => e.type === "bot:text:done"), 5000);

    const done = events.find((e) => e.type === "bot:text:done");
    expect(done).toBeDefined();
    if (done?.type === "bot:text:done") {
      expect(done.text).toContain("book a flight");
      expect(done.partial).toBe(false);
    }

    await waitFor(() => audioOut.length >= 1, 3000);
    expect(audioOut.length).toBeGreaterThanOrEqual(1);
    expect(tts.synthesized.length).toBeGreaterThanOrEqual(1);
    expect(session?.history.length).toBeGreaterThanOrEqual(2);

    await client.disconnect();
    await session?.close();
  });

  it(
    "runs a full Session audio turn (VAD → STT → brain → TTS) over WebSocket",
    async () => {
      const { port, wss } = await listen();
      let session: Session | undefined;
      const tts = new MockTTS();

      wss.on("connection", (socket) => {
        const transport = fromWebSocket(socket, {
          onClose: () => {
            void session?.close();
          },
        });

        session = new Session({
          transport,
          stt: new MockSTT("hello voice world"),
          tts,
          brain: async function* (text) {
            yield `Heard: ${text}.`;
          },
          session: { maxDurationMs: 60_000, idleTimeoutMs: 60_000 },
          // Sensitive VAD for synthetic sine waves
          vad: { confidence: 0.05, silenceMs: 200, minSpeechMs: 50 },
        });

        void session.start();
      });

      const client = new WsTransport({
        url: `ws://127.0.0.1:${port}`,
        WebSocketImpl: WS,
      });

      const events: ServerToClientEvent[] = [];
      const audioOut: ArrayBuffer[] = [];
      client.onEvent((e) => {
        events.push(e as ServerToClientEvent);
      });
      client.onAudio((c) => {
        audioOut.push(c);
      });

      await client.connect("ses_voice");
      client.sendEvent({
        type: "client:ready",
        capabilities: { audio: true, sampleRate: 16000 },
      });
      await waitFor(() =>
        events.some((e) => e.type === "state:change" && e.state === "listening"),
      );

      // Stream speech-like audio (above VAD threshold), then silence to end utterance
      const speechChunk = makeSpeechPcm(100);
      for (let i = 0; i < 8; i++) {
        client.sendAudio(speechChunk);
        // let the event loop process each chunk
        await new Promise((r) => setTimeout(r, 5));
      }
      const silence = makeSilencePcm(300);
      for (let i = 0; i < 4; i++) {
        client.sendAudio(silence);
        await new Promise((r) => setTimeout(r, 5));
      }

      await waitFor(
        () => events.some((e) => e.type === "transcript:final" && e.text.length > 0),
        5000,
      );

      const finals = events.filter(
        (e): e is Extract<ServerToClientEvent, { type: "transcript:final" }> =>
          e.type === "transcript:final",
      );
      expect(finals.some((f) => f.text === "hello voice world")).toBe(true);

      await waitFor(
        () =>
          events.some(
            (e) => e.type === "bot:text:done" && e.text.includes("hello voice world"),
          ),
        5000,
      );

      const bot = events.find(
        (e) => e.type === "bot:text:done" && e.text.includes("hello voice world"),
      );
      expect(bot).toBeDefined();
      expect(audioOut.length).toBeGreaterThanOrEqual(1);
      expect(tts.synthesized.length).toBeGreaterThanOrEqual(1);

      await client.disconnect();
      await session?.close();
    },
    15_000,
  );

  it(
    "interrupts speaking when a new text turn arrives",
    async () => {
      const { port, wss } = await listen();
      let session: Session | undefined;

      wss.on("connection", (socket) => {
        const transport = fromWebSocket(socket);
        session = new Session({
          transport,
          stt: new MockSTT(),
          tts: new MockTTS(),
          brain: async function* (text) {
            if (text === "first") {
              yield "Long answer one. ";
              await new Promise((r) => setTimeout(r, 300));
              yield "Should not always finish.";
            } else {
              yield "Short second answer.";
            }
          },
          session: { maxDurationMs: 60_000, idleTimeoutMs: 60_000 },
        });
        void session.start();
      });

      const client = new WsTransport({
        url: `ws://127.0.0.1:${port}`,
        WebSocketImpl: WS,
      });
      const events: ServerToClientEvent[] = [];
      client.onEvent((e) => events.push(e as ServerToClientEvent));

      await client.connect("ses_int");
      client.sendEvent({
        type: "client:ready",
        capabilities: { audio: true },
      });
      await waitFor(() =>
        events.some((e) => e.type === "state:change" && e.state === "listening"),
      );

      client.sendEvent({ type: "text:send", text: "first" });
      await waitFor(() => events.some((e) => e.type === "bot:text:delta"), 3000);

      // Barge-in
      client.sendEvent({ type: "text:send", text: "second" });

      await waitFor(
        () =>
          events.some(
            (e) =>
              e.type === "bot:text:done" &&
              e.text.includes("Short second answer"),
          ),
        8000,
      );

      const second = events.find(
        (e) => e.type === "bot:text:done" && e.text.includes("Short second answer"),
      );
      expect(second).toBeDefined();

      // At least one flush should have been sent on interrupt
      expect(events.some((e) => e.type === "audio:flush")).toBe(true);

      await client.disconnect();
      await session?.close();
    },
    15_000,
  );
});
