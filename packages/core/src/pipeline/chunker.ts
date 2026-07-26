import type { Frame, Processor } from "../interfaces/processor.js";
import { DEFAULT_CHUNKER_CONFIG, type ChunkerConfig } from "../types.js";

/**
 * Sentence-ending punctuation for TTS chunking.
 *
 * Deliberately excludes comma — commas are clause pauses, not sentence ends,
 * and flushing on every comma makes TTS choppy.
 *
 * `.` is handled separately so we never split decimals / versions mid-stream
 * (e.g. tokens arrive as `"3."` then `"14"`).
 */
const HARD_SENTENCE_END = /[!?…;:…。！？\n]/u;

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/** True if `index` points at a `.` that sits inside a number / version-like run. */
function isDecimalOrVersionDot(buffer: string, index: number): boolean {
  if (buffer[index] !== ".") return false;
  const prev = index > 0 ? buffer[index - 1] : undefined;
  const next = index + 1 < buffer.length ? buffer[index + 1] : undefined;
  // 3.14 / v1.2 / 10.0.0
  return isDigit(prev) && isDigit(next);
}

/**
 * True when a trailing `digit.` (or `digit,`) might still grow into a number
 * because no non-digit has arrived after the punctuation yet.
 * Holds the buffer until more text or an explicit flush.
 */
function isAmbiguousNumericTail(buffer: string, punctIndex: number): boolean {
  const ch = buffer[punctIndex];
  if (ch !== "." && ch !== ",") return false;
  const prev = punctIndex > 0 ? buffer[punctIndex - 1] : undefined;
  if (!isDigit(prev)) return false;
  const after = buffer.slice(punctIndex + 1);
  // No more text yet, or only whitespace — next token might be more digits.
  return after.length === 0 || /^\s*$/.test(after);
}

/**
 * Buffers streaming text tokens into sentence-sized chunks for natural TTS.
 * Flushes on hard punctuation or maxChars, whichever comes first.
 * Protects decimals, version numbers, and mid-stream numeric punctuation.
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
      this.drainPunctuation(sentences);
    }

    while (this.buffer.length >= this.config.maxChars) {
      // Prefer splitting on last space within window; never split inside a decimal.
      const window = this.buffer.slice(0, this.config.maxChars);
      let splitAt = window.lastIndexOf(" ");
      if (splitAt < this.config.maxChars * 0.4) {
        splitAt = this.findSafeHardSplit(this.config.maxChars);
      }
      // Avoid leaving a dangling "3." when maxChars lands after a decimal point.
      while (splitAt > 1 && isAmbiguousNumericTail(this.buffer, splitAt - 1)) {
        splitAt -= 1;
      }
      if (splitAt <= 0) break;

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

  private drainPunctuation(sentences: Frame[]): void {
    let i = 0;
    while (i < this.buffer.length) {
      const ch = this.buffer[i]!;

      // Hard ends always flush.
      if (HARD_SENTENCE_END.test(ch)) {
        const end = i + 1;
        const chunk = this.buffer.slice(0, end).trim();
        if (chunk.length > 0) {
          sentences.push({ kind: "sentence", text: chunk });
        }
        this.buffer = this.buffer.slice(end);
        i = 0;
        continue;
      }

      // Period: sentence end, unless decimal/version or ambiguous streaming tail.
      if (ch === ".") {
        if (isDecimalOrVersionDot(this.buffer, i)) {
          i += 1;
          continue;
        }
        if (isAmbiguousNumericTail(this.buffer, i)) {
          // Wait for more tokens or explicit flush — do not split "3." from "14".
          break;
        }
        const end = i + 1;
        const chunk = this.buffer.slice(0, end).trim();
        if (chunk.length > 0) {
          sentences.push({ kind: "sentence", text: chunk });
        }
        this.buffer = this.buffer.slice(end);
        i = 0;
        continue;
      }

      i += 1;
    }
  }

  /**
   * When there is no good space to split on, walk back from maxChars so we
   * don't cut through a `digit.digit` run.
   */
  private findSafeHardSplit(maxChars: number): number {
    let splitAt = Math.min(maxChars, this.buffer.length);
    while (splitAt > 1) {
      const prev = this.buffer[splitAt - 1];
      const next = this.buffer[splitAt];
      // Don't split between digit and `.`/`,` or between `.`/`,` and digit.
      if (
        (isDigit(prev) && (next === "." || next === ",")) ||
        ((prev === "." || prev === ",") && isDigit(next)) ||
        (isDigit(prev) && isDigit(next))
      ) {
        splitAt -= 1;
        continue;
      }
      break;
    }
    return splitAt > 0 ? splitAt : maxChars;
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
