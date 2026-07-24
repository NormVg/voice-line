import { describe, expect, it } from "vitest";
import { SentenceChunker } from "../src/pipeline/chunker.js";

describe("SentenceChunker", () => {
  it("flushes on sentence-ending punctuation", async () => {
    const chunker = new SentenceChunker();
    const a = chunker.process({ kind: "text", text: "Hello there. " });
    expect(a).toEqual([{ kind: "sentence", text: "Hello there." }]);

    const b = chunker.process({ kind: "text", text: "How are you?" });
    expect(b).toEqual([{ kind: "sentence", text: "How are you?" }]);
  });

  it("buffers incomplete sentences", () => {
    const chunker = new SentenceChunker();
    const r = chunker.process({ kind: "text", text: "Hello there" });
    expect(r).toBeNull();

    const flushed = chunker.process({ kind: "flush" });
    expect(flushed).toEqual([{ kind: "sentence", text: "Hello there" }, { kind: "flush" }]);
  });

  it("flushes at maxChars", () => {
    const chunker = new SentenceChunker({ maxChars: 20, flushOnPunctuation: false });
    const text = "word ".repeat(10); // 50 chars
    const r = chunker.process({ kind: "text", text });
    expect(Array.isArray(r)).toBe(true);
    if (Array.isArray(r)) {
      expect(r.every((f) => f.kind === "sentence")).toBe(true);
      expect(r.length).toBeGreaterThan(0);
    }
  });
});
