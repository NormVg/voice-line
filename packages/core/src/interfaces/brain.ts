import type { Message } from "../types.js";

/**
 * The developer's LLM logic. voice-line calls this with transcribed text.
 * Return a string for simple responses, or an async generator to stream tokens.
 * Streaming is strongly recommended — TTS can start before the full response.
 */
export type Brain = (
  userText: string,
  context: BrainContext,
) => Promise<string> | AsyncGenerator<string, void, unknown>;

export interface BrainContext {
  sessionId: string;
  history: readonly Message[];
  /** Cancel the current brain generation (used by dual-brain handoff / interrupt). */
  interrupt: () => void;
  /** Signal that can be checked / aborted when the user interrupts. */
  signal: AbortSignal;
  metadata: Record<string, unknown>;
}

/** Result of consuming a Brain response (string or async generator). */
export interface BrainResult {
  text: string;
  partial: boolean;
  usedTools?: boolean;
}

/**
 * Normalize a Brain return value into an async iterable of tokens.
 */
export async function* brainToStream(
  result: Promise<string> | AsyncGenerator<string, void, unknown> | string,
): AsyncGenerator<string, void, unknown> {
  const resolved = await result;
  if (typeof resolved === "string") {
    if (resolved.length > 0) yield resolved;
    return;
  }
  // AsyncGenerator
  yield* resolved;
}

/**
 * Consume a brain stream, collecting full text. Respects AbortSignal.
 */
export async function collectBrainStream(
  stream: AsyncIterable<string>,
  signal?: AbortSignal,
): Promise<BrainResult> {
  let text = "";
  try {
    for await (const token of stream) {
      if (signal?.aborted) {
        return { text, partial: true };
      }
      text += token;
    }
    return { text, partial: false };
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      return { text, partial: true };
    }
    throw err;
  }
}
