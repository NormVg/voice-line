import { describe, expect, it } from "vitest";
import type { Frame, Processor } from "../src/interfaces/processor.js";
import { Pipeline } from "../src/pipeline/pipeline.js";

class UppercaseText implements Processor {
  readonly name = "upper";
  process(frame: Frame): Frame | null {
    if (frame.kind !== "text") return frame;
    return { kind: "text", text: frame.text.toUpperCase() };
  }
}

class DropAudio implements Processor {
  readonly name = "drop-audio";
  process(frame: Frame): Frame | null {
    if (frame.kind === "audio") return null;
    return frame;
  }
}

describe("Pipeline", () => {
  it("chains processors in order", async () => {
    const pipeline = new Pipeline([new DropAudio(), new UppercaseText()]);
    const out: Frame[] = [];
    pipeline.onFrame((f) => {
      out.push(f);
    });

    await pipeline.push({ kind: "audio", data: new ArrayBuffer(4), sampleRate: 16000 });
    await pipeline.push({ kind: "text", text: "hi" });

    expect(out).toEqual([{ kind: "text", text: "HI" }]);
  });

  it("emits error frames from throwing processors", async () => {
    const boom: Processor = {
      name: "boom",
      process() {
        throw new Error("nope");
      },
    };
    const pipeline = new Pipeline([boom]);
    const out: Frame[] = [];
    pipeline.onFrame((f) => {
      out.push(f);
    });
    await pipeline.push({ kind: "text", text: "x" });
    expect(out[0]?.kind).toBe("error");
  });
});
