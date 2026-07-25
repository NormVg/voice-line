import type { Frame, Processor } from "../interfaces/processor.js";
import { DEFAULT_CHUNKER_CONFIG, type ChunkerConfig } from "../types.js";

const SENTENCE_END = /(?:(?<!\d)[.,]|[.,](?!\d)|[!?…;:…。！？،、，\n])/u;

/**
 * Buffers streaming text tokens into sentence-sized chunks for natural TTS.
 * Flushes on punctuation or maxChars, whichever comes first.
 */
export class SentenceChunker implements Processor {
  readonly name = "sentence-chunker";

  private readonly config: ChunkerConfig;
  private buffer = "";

  constructor(config: Partial<ChunkerConfig> = {}) {
    this.config = { ...DEFAULT_CHUNKER_CONFIG, ...config };
  }

  process(frame: Frame): Frame | Frame[] | null {
    if (frame.kind === "flush") {
      return this.flushRemainder();
    }

    if (frame.kind !== "text") {
      return frame;
    }

    this.buffer += frame.text;
    const sentences: Frame[] = [];

    if (this.config.flushOnPunctuation) {
      let match: RegExpExecArray | null;
      // Scan for sentence boundaries while leaving trailing incomplete text
      // biome-ignore lint/suspicious/noAssignInExpressions: intentional scan loop
      while ((match = SENTENCE_END.exec(this.buffer)) !== null) {
        const end = match.index + match[0].length;
        // Prefer flush at boundary if we have enough context, or always on punct
        const chunk = this.buffer.slice(0, end).trim();
        if (chunk.length > 0) {
          sentences.push({ kind: "sentence", text: chunk });
        }
        this.buffer = this.buffer.slice(end);
        SENTENCE_END.lastIndex = 0;
      }
    }

    while (this.buffer.length >= this.config.maxChars) {
      // Prefer splitting on last space within window
      const window = this.buffer.slice(0, this.config.maxChars);
      let splitAt = window.lastIndexOf(" ");
      if (splitAt < this.config.maxChars * 0.4) {
        splitAt = this.config.maxChars;
      }
      const chunk = this.buffer.slice(0, splitAt).trim();
      if (chunk.length > 0) {
        sentences.push({ kind: "sentence", text: chunk });
      }
      this.buffer = this.buffer.slice(splitAt).trimStart();
    }

    return sentences.length > 0 ? sentences : null;
  }

  reset(): void {
    this.buffer = "";
  }

  private flushRemainder(): Frame[] {
    const out: Frame[] = [];
    const rem = this.buffer.trim();
    if (rem.length > 0) {
      out.push({ kind: "sentence", text: rem });
    }
    this.buffer = "";
    out.push({ kind: "flush" });
    return out;
  }
}
