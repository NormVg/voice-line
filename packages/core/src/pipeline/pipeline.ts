import type { Frame, Processor } from "../interfaces/processor.js";

export type PipelineListener = (frame: Frame) => void | Promise<void>;

/**
 * Ordered chain of processors. Synchronous topology, async-friendly process path.
 *
 * push(frame) → processor[0] → ... → processor[n] → listeners
 *
 * Processors may return 0, 1, or many frames. Errors become error frames.
 */
export class Pipeline {
  private readonly processors: Processor[];
  private readonly listeners = new Set<PipelineListener>();
  private destroyed = false;

  constructor(processors: Processor[] = []) {
    this.processors = [...processors];
  }

  get stages(): readonly Processor[] {
    return this.processors;
  }

  use(processor: Processor): this {
    this.processors.push(processor);
    return this;
  }

  onFrame(listener: PipelineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async push(frame: Frame): Promise<void> {
    if (this.destroyed) return;
    let current: Frame[] = [frame];

    for (const processor of this.processors) {
      const next: Frame[] = [];
      for (const f of current) {
        try {
          const result = await processor.process(f);
          if (result == null) continue;
          if (Array.isArray(result)) {
            next.push(...result);
          } else {
            next.push(result);
          }
        } catch (err) {
          next.push({
            kind: "error",
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
      current = next;
      if (current.length === 0) return;
    }

    for (const out of current) {
      await this.emit(out);
    }
  }

  /** Reset all processors (used on interruption). */
  reset(): void {
    for (const p of this.processors) {
      p.reset?.();
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.listeners.clear();
    for (const p of this.processors) {
      await p.destroy?.();
    }
    this.processors.length = 0;
  }

  private async emit(frame: Frame): Promise<void> {
    for (const listener of this.listeners) {
      await listener(frame);
    }
  }
}
