import { describe, expect, it } from "vitest";
import type { Brain, BrainContext } from "@voice-line/core";
import { dualBrain } from "../src/dual-brain.js";

function makeCtx(signal?: AbortSignal): BrainContext {
  const ac = new AbortController();
  return {
    sessionId: "test",
    history: [],
    interrupt: () => ac.abort(),
    signal: signal ?? ac.signal,
    metadata: {},
  };
}

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const t of gen) out += t;
  return out;
}

describe("dualBrain", () => {
  it("streams fast then heavy on interrupt handoff", async () => {
    const fast: Brain = async function* () {
      yield "On it!";
    };
    const heavy: Brain = async function* () {
      // Simulate work finishing quickly
      yield "Flight booked to Mumbai.";
    };

    const brain = dualBrain({ fast, heavy, handoff: "wait" });
    const text = await collect(brain("book flight", makeCtx()) as AsyncGenerator<string>);
    expect(text).toContain("On it!");
    expect(text).toContain("Flight booked to Mumbai.");
  });

  it("respects keep-fast handoff", async () => {
    const fast: Brain = async function* () {
      yield "Hello!";
    };
    const heavy: Brain = async function* () {
      yield "Heavy answer";
    };

    const brain = dualBrain({
      fast,
      heavy,
      handoff: () => "keep-fast",
    });
    const text = await collect(brain("hi", makeCtx()) as AsyncGenerator<string>);
    expect(text).toBe("Hello!");
    expect(text).not.toContain("Heavy");
  });
});
