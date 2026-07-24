import { describe, expect, it } from "vitest";
import type { AudioChunk, STTProvider, STTStream, TTSProvider } from "../src/index.js";
import { Session, createMemoryTransportPair } from "../src/index.js";

class FakeSTT implements STTProvider {
  createStream(): STTStream {
    return {
      write() {},
      on() {
        return () => {};
      },
      close: async () => {},
    };
  }
}

/**
 * TTS that takes longer for the first sentence than the second.
 * If synthesis runs in parallel, audio order would reverse.
 */
class SlowThenFastTTS implements TTSProvider {
  public order: string[] = [];
  private aborted = false;

  async *synthesize(text: string): AsyncIterable<AudioChunk> {
    this.aborted = false;
    const delay = text.includes("FIRST") ? 80 : 10;
    await new Promise((r) => setTimeout(r, delay));
    if (this.aborted) return;
    this.order.push(text);
    const data = new TextEncoder().encode(text).buffer;
    yield { data, sampleRate: 16000, format: "pcm16" };
  }

  abort(): void {
    this.aborted = true;
  }
}

describe("Session TTS ordering", () => {
  it("sends sentence audio in text order even when later sentences synthesize faster", async () => {
    const { server, client } = createMemoryTransportPair();
    const tts = new SlowThenFastTTS();
    const audioPayloads: string[] = [];

    client.onAudio((chunk) => {
      audioPayloads.push(new TextDecoder().decode(chunk));
    });

    const session = new Session({
      transport: server,
      stt: new FakeSTT(),
      tts,
      brain: async function* () {
        // Two sentences — second is faster to synthesize
        yield "FIRST sentence ends here! ";
        yield "SECOND is quicker.";
      },
      session: { maxDurationMs: 60_000, idleTimeoutMs: 60_000 },
    });

    await session.start();
    session.ready();
    await client.connect("ord");

    await session.handleTextInput("go");
    // Allow TTS queue to drain
    await new Promise((r) => setTimeout(r, 250));

    expect(tts.order.length).toBeGreaterThanOrEqual(2);
    expect(tts.order[0]).toContain("FIRST");
    expect(tts.order[1]).toContain("SECOND");
    expect(audioPayloads[0]).toContain("FIRST");
    expect(audioPayloads[1]).toContain("SECOND");

    await session.close();
  });

  it("emits only one transcript:final per user turn", async () => {
    const { server, client } = createMemoryTransportPair();
    const finals: string[] = [];

    client.onEvent((e) => {
      if (e.type === "transcript:final") finals.push(e.text);
    });

    const session = new Session({
      transport: server,
      stt: new FakeSTT(),
      tts: new SlowThenFastTTS(),
      brain: async function* () {
        yield "ok.";
      },
      session: { maxDurationMs: 60_000, idleTimeoutMs: 60_000 },
    });

    await session.start();
    session.ready();
    await client.connect("once");

    await session.handleTextInput("hello there");
    await new Promise((r) => setTimeout(r, 100));

    expect(finals).toEqual(["hello there"]);

    await session.close();
  });
});
