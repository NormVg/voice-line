import { describe, expect, it } from "vitest";
import {
  createMemoryTransportPair,
  VoiceLineError,
  type Brain,
  type STTProvider,
  type STTStream,
  type TTSProvider,
  type AudioChunk,
} from "@voice-line/core";
import { SessionManager } from "../src/session-manager.js";

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

class FakeTTS implements TTSProvider {
  async *synthesize(): AsyncIterable<AudioChunk> {
    yield { data: new ArrayBuffer(0), sampleRate: 16000, format: "pcm16" };
  }
  abort() {}
}

const brain: Brain = async function* () {
  yield "ok";
};

describe("SessionManager capacity", () => {
  it("rejects create when maxSessions is reached", async () => {
    const { server: t1 } = createMemoryTransportPair();
    const { server: t2 } = createMemoryTransportPair();
    const transports = [t1, t2];
    let i = 0;

    const manager = new SessionManager({
      transport: () => transports[i++]!,
      stt: new FakeSTT(),
      tts: new FakeTTS(),
      brain,
      maxSessions: 1,
      session: { maxDurationMs: 60_000, idleTimeoutMs: 60_000 },
    });

    const first = await manager.create("a");
    expect(first.session.id).toBe("a");
    expect(manager.size).toBe(1);

    await expect(manager.create("b")).rejects.toMatchObject({
      code: "ERR_CAPACITY",
    });
    await expect(manager.create("b")).rejects.toBeInstanceOf(VoiceLineError);

    await manager.destroy("a");
    expect(manager.size).toBe(0);

    // After destroy, capacity frees up
    const { server: t3 } = createMemoryTransportPair();
    const manager2 = new SessionManager({
      transport: t3,
      stt: new FakeSTT(),
      tts: new FakeTTS(),
      brain,
      maxSessions: 1,
      session: { maxDurationMs: 60_000, idleTimeoutMs: 60_000 },
    });
    await expect(manager2.create("c")).resolves.toBeDefined();
    await manager2.destroyAll();
  });
});
