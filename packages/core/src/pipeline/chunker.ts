import type { Frame, Processor } from "../interfaces/processor.js";
import { DEFAULT_CHUNKER_CONFIG, type ChunkerConfig } from "../types.js";

const SENTENCE_END = /(?:(?<!\d)[.,]|[.,](?!\d)|[!?…;:…。！？،、，\n])/u;

/**
 * Buffers streaming text tokens and flushes chunks based on word count
 * or punctuation boundaries, balancing low latency with TTS quality.
 */
export class SentenceChunker implements Processor {
  readonly name = "sentence-chunker";

  private readonly config: ChunkerConfig;
  private buffer = "";
  // X words batch limit
  private readonly WORD_BATCH_SIZE = 6;

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

    while (true) {
      const trimmed = this.buffer.trimStart();
      if (!trimmed) break;

      // 1. Check for punctuation boundary first
      const punctMatch = SENTENCE_END.exec(trimmed);
      const words = trimmed.split(/\s+/).filter(w => w.length > 0);

      // 2. Decide where to split
      let splitIndex = -1;

      if (punctMatch) {
        // If there's punctuation, check if it's at the very end of our current buffer
        const matchEnd = punctMatch.index + punctMatch[0].length;
        const isAtEnd = matchEnd === trimmed.length;
        const matchedChar = punctMatch[0].trim();
        
        // If it's a period or comma at the absolute edge of the buffer, 
        // we MUST wait for the next token. If the next token is "000", it's a number like "2,000".
        // If the next token is " How", then we'll split it on the next pass.
        if (isAtEnd && (matchedChar === "." || matchedChar === ",")) {
          // It's ambiguous, don't split yet
        } else {
          splitIndex = matchEnd;
        }
      } 
      
      if (splitIndex === -1 && words.length >= this.WORD_BATCH_SIZE) {
        // If we reached our X-word batch limit, split after the Xth word
        let wordCount = 0;
        let inWord = false;
        
        for (let i = 0; i < trimmed.length; i++) {
          const isSpace = /\s/.test(trimmed[i]!);
          if (!isSpace && !inWord) {
            inWord = true;
            wordCount++;
          } else if (isSpace && inWord) {
            inWord = false;
            if (wordCount === this.WORD_BATCH_SIZE) {
              splitIndex = i;
              break;
            }
          }
        }
      }

      // If we found a boundary (either punctuation or word count)
      if (splitIndex !== -1) {
        const chunk = trimmed.slice(0, splitIndex).trim();
        if (chunk.length > 0) {
          sentences.push({ kind: "sentence", text: chunk });
        }
        this.buffer = trimmed.slice(splitIndex);
      } else {
        // Not enough words and no punctuation boundary found, keep buffering
        this.buffer = trimmed;
        break;
      }
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
