import type { Brain, BrainContext, BrainResult } from "@voice-line/core";
import { brainToStream, collectBrainStream } from "@voice-line/core";

export type HandoffMode = "interrupt" | "wait";

export type HandoffDecision = "interrupt" | "keep-fast" | "wait";

export type HandoffFn = (
  fastResult: BrainResult,
  heavyResult: BrainResult,
  ctx: BrainContext,
) => HandoffDecision | Promise<HandoffDecision>;

export interface DualBrainOptions {
  /** Small/fast model — ack in ~200ms. */
  fast: Brain;
  /** Heavy model / agent — real work. */
  heavy: Brain;
  /**
   * When the heavy brain finishes:
   * - `'interrupt'` — stop fast, deliver heavy (default)
   * - `'wait'` — let fast finish, then deliver heavy
   * - function — custom decision
   */
  handoff?: HandoffMode | HandoffFn;
}

/**
 * Dispatches user text to two brains in parallel.
 * Fast brain fills dead air; heavy brain delivers the real answer.
 */
export function dualBrain(options: DualBrainOptions): Brain {
  const handoff = options.handoff ?? "interrupt";

  return async function* dualBrainStream(
    userText: string,
    ctx: BrainContext,
  ): AsyncGenerator<string, void, unknown> {
    const parent = ctx.signal;
    if (parent.aborted) return;

    const fastAbort = new AbortController();
    const heavyAbort = new AbortController();

    const linkAbort = () => {
      fastAbort.abort();
      heavyAbort.abort();
    };
    parent.addEventListener("abort", linkAbort, { once: true });

    const fastCtx: BrainContext = {
      ...ctx,
      signal: fastAbort.signal,
      interrupt: () => fastAbort.abort(),
      metadata: { ...ctx.metadata, dualBrain: "fast" },
    };
    const heavyCtx: BrainContext = {
      ...ctx,
      signal: heavyAbort.signal,
      interrupt: () => heavyAbort.abort(),
      metadata: { ...ctx.metadata, dualBrain: "heavy" },
    };

    // Shared box so the fast loop can poll heavy completion without
    // fighting TypeScript control-flow analysis on closed-over lets.
    const heavyBox: { result: BrainResult | null; settled: boolean } = {
      result: null,
      settled: false,
    };
    let dropHeavy = false;

    const heavyTask = collectBrainStream(
      brainToStream(options.heavy(userText, heavyCtx)),
      heavyAbort.signal,
    )
      .then((result) => {
        heavyBox.result = result;
        heavyBox.settled = true;
        return result;
      })
      .catch((): BrainResult => {
        heavyBox.settled = true;
        return { text: "", partial: true };
      });

    let fastText = "";
    let stoppedForHandoff = false;

    try {
      for await (const token of brainToStream(options.fast(userText, fastCtx))) {
        if (parent.aborted) break;

        if (heavyBox.settled && heavyBox.result && !stoppedForHandoff && !dropHeavy) {
          const decision = await resolveHandoff(
            handoff,
            { text: fastText, partial: true },
            heavyBox.result,
            ctx,
          );
          if (decision === "interrupt") {
            fastAbort.abort();
            stoppedForHandoff = true;
            break;
          }
          if (decision === "keep-fast") {
            heavyAbort.abort();
            dropHeavy = true;
          }
          // 'wait' — keep streaming fast; heavy delivered after
        }

        fastText += token;
        yield token;
      }
    } catch (err) {
      if (!fastAbort.signal.aborted && !parent.aborted) {
        parent.removeEventListener("abort", linkAbort);
        throw err;
      }
    }

    let heavyResult: BrainResult;
    try {
      heavyResult = await heavyTask;
    } catch {
      parent.removeEventListener("abort", linkAbort);
      return;
    }

    parent.removeEventListener("abort", linkAbort);
    if (parent.aborted || dropHeavy) return;
    if (heavyResult.text.length === 0 || heavyAbort.signal.aborted) return;

    const decision = await resolveHandoff(
      handoff,
      { text: fastText, partial: stoppedForHandoff },
      heavyResult,
      ctx,
    );

    if (decision === "keep-fast") return;

    if (fastText.length > 0 && !fastText.endsWith("\n")) {
      yield "\n\n";
    }
    yield heavyResult.text;
  };
}

async function resolveHandoff(
  handoff: HandoffMode | HandoffFn,
  fastResult: BrainResult,
  heavyResult: BrainResult,
  ctx: BrainContext,
): Promise<HandoffDecision> {
  if (typeof handoff === "function") {
    return handoff(fastResult, heavyResult, ctx);
  }
  return handoff === "wait" ? "wait" : "interrupt";
}
