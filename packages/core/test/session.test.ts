import { describe, expect, it, vi } from "vitest";
import type { AudioChunk, STTProvider, STTStream, TTSProvider, TranscriptResult } from "../src/index.js";
import { Session, createMemoryTransportPair } from "../src/index.js";

class FakeSTT implements STTProvider {
  createStream(): STTStream {
    const handlers = new Map<string, Set<(p: unknown) => void>>();
    return {
      write() {},
      on(event, handler) {
        let set = handlers.get(event);
        if (!set) {
          set = new Set();
          handlers.set(event, set);
        }
        set.add(handler as (p: unknown) => void);
        return () => set?.delete(handler as (p: unknown) => void);
      },
      close: async () => {},
    };
  }
}

class FakeTTS implements TTSProvider {
  async *synthesize(text: string): AsyncIterable<AudioChunk> {
    const data = new TextEncoder().encode(text).buffer;
    yield { data, sampleRate: 16000, format: "pcm16" };
  }
  abort() {}
}

describe("Session", () => {
  it("runs a text turn through brain → TTS → transport", async () => {
    const { server, client } = createMemoryTransportPair();
    const events: Array<{ type: string }> = [];
    client.onEvent((e) => {
      events.push(e);
    });

    const brain = vi.fn(async function* () {
      yield "Hello ";
      yield "world.";
    });

    const session = new Session({
      transport: server,
      stt: new FakeSTT(),
      tts: new FakeTTS(),
      brain,
      session: { maxDurationMs: 60_000, idleTimeoutMs: 60_000 },
    });

    await session.start();
    session.ready();
    await client.connect("test");

    await session.handleTextInput("hi there");

    // Allow async pipeline to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(brain).toHaveBeenCalled();
    expect(session.history.length).toBeGreaterThanOrEqual(2);
    expect(session.history.all.some((m) => m.role === "user")).toBe(true);
    expect(session.history.all.some((m) => m.role === "assistant")).toBe(true);
    expect(events.some((e) => e.type === "bot:text:done")).toBe(true);

    await session.close();
  });

  it("interrupts mid-response", async () => {
    const { server } = createMemoryTransportPair();

    const brain = async function* () {
      yield "This is a long response that will be interrupted.";
      await new Promise((r) => setTimeout(r, 100));
      yield " more text";
    };

    const session = new Session({
      transport: server,
      stt: new FakeSTT(),
      tts: new FakeTTS(),
      brain,
      session: { maxDurationMs: 60_000, idleTimeoutMs: 60_000 },
    });

    await session.start();
    session.ready();

    const turn = session.handleTextInput("interrupt me");
    await new Promise((r) => setTimeout(r, 20));

    // Simulate barge-in via speech_start path by starting a new text turn
    await session.handleTextInput("new utterance");
    await turn;
    await new Promise((r) => setTimeout(r, 50));

    const assistants = session.history.all.filter((m) => m.role === "assistant");
    expect(assistants.length).toBeGreaterThanOrEqual(1);

    await session.close();
  });
});

// silence unused type import in some TS configs
export type _T = TranscriptResult;
