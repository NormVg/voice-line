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

  it("does not split decimals like 3.14", () => {
    const chunker = new SentenceChunker();
    const r = chunker.process({ kind: "text", text: "Pi is about 3.14 today." });
    expect(r).toEqual([{ kind: "sentence", text: "Pi is about 3.14 today." }]);
  });

  it("does not split currency amounts", () => {
    const chunker = new SentenceChunker();
    const r = chunker.process({ kind: "text", text: "Total is $1,234.56 please." });
    // comma is not a sentence end; only period closes
    expect(r).toEqual([{ kind: "sentence", text: "Total is $1,234.56 please." }]);
  });

  it("does not split version numbers", () => {
    const chunker = new SentenceChunker();
    const r = chunker.process({ kind: "text", text: "Upgrade to v1.2.3 now." });
    expect(r).toEqual([{ kind: "sentence", text: "Upgrade to v1.2.3 now." }]);
  });

  it("holds streaming digit+period until more digits or flush", () => {
    const chunker = new SentenceChunker();
    // Tokens often arrive as "3." then "14"
    const a = chunker.process({ kind: "text", text: "The value is 3." });
    expect(a).toBeNull();

    const b = chunker.process({ kind: "text", text: "14 exactly." });
    expect(b).toEqual([{ kind: "sentence", text: "The value is 3.14 exactly." }]);
  });

  it("flushes digit+period on explicit flush (true end of sentence)", () => {
    const chunker = new SentenceChunker();
    const a = chunker.process({ kind: "text", text: "Pick number 3." });
    expect(a).toBeNull(); // ambiguous until flush

    const flushed = chunker.process({ kind: "flush" });
    expect(flushed).toEqual([{ kind: "sentence", text: "Pick number 3." }, { kind: "flush" }]);
  });

  it("does not flush on commas mid-clause", () => {
    const chunker = new SentenceChunker();
    const r = chunker.process({ kind: "text", text: "Hello, world how are you" });
    expect(r).toBeNull();
  });
});
