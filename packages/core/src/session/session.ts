import type { VoiceLineEvent } from "../events.js";
import { toVoiceLineError, type VoiceLineError } from "../errors.js";
import type { Brain, BrainContext } from "../interfaces/brain.js";
import { brainToStream } from "../interfaces/brain.js";
import type { Frame } from "../interfaces/processor.js";
import type { STTProvider } from "../interfaces/stt.js";
import type { TTSProvider } from "../interfaces/tts.js";
import type { Transport } from "../interfaces/transport.js";
import { SentenceChunker } from "../pipeline/chunker.js";
import { Pipeline } from "../pipeline/pipeline.js";
import { STTProcessor } from "../pipeline/stt-processor.js";
import { VADProcessor } from "../pipeline/vad.js";
import type {
  AudioConfig,
  ChunkerConfig,
  SessionConfig,
  SessionState,
  STTConfig,
  TTSConfig,
  Unsubscribe,
  VADConfig,
} from "../types.js";
import {
  DEFAULT_AUDIO_CONFIG,
  DEFAULT_CHUNKER_CONFIG,
  DEFAULT_SESSION_CONFIG,
  DEFAULT_VAD_CONFIG,
} from "../types.js";
import { createId } from "../utils/id.js";
import { MessageHistory } from "./history.js";

function eagerStream<T>(iterable: AsyncIterable<T>): AsyncIterable<T> {
  const queue: (T | Error)[] = [];
  let done = false;
  const state: { resolveWaiting: (() => void) | null } = { resolveWaiting: null };

  void (async () => {
    try {
      for await (const item of iterable) {
        queue.push(item);
        if (state.resolveWaiting) {
          const rw = state.resolveWaiting;
          state.resolveWaiting = null;
          rw();
        }
      }
    } catch (err) {
      queue.push(err instanceof Error ? err : new Error(String(err)));
    } finally {
      done = true;
      if (state.resolveWaiting) {
        const rw = state.resolveWaiting;
        state.resolveWaiting = null;
        rw();
      }
    }
  })();

  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length > 0) {
          const item = queue.shift();
          if (item instanceof Error) throw item;
          yield item as T;
        } else if (done) {
          break;
        } else {
          await new Promise<void>((resolve) => {
            state.resolveWaiting = resolve;
          });
        }
      }
    },
  };
}

export interface SessionOptions {
  id?: string;
  transport: Transport;
  stt: STTProvider;
  tts: TTSProvider;
  brain: Brain;
  audio?: Partial<AudioConfig>;
  vad?: Partial<VADConfig>;
  chunker?: Partial<ChunkerConfig>;
  session?: Partial<SessionConfig>;
  sttConfig?: STTConfig;
  ttsConfig?: TTSConfig;
  metadata?: Record<string, unknown>;
  onStateChange?: (state: SessionState, prev: SessionState) => void;
  onError?: (error: VoiceLineError) => void;
}

type StateListener = (state: SessionState, prev: SessionState) => void;

/**
 * A single voice conversation. Owns:
 * - transport connection
 * - inbound pipeline (VAD → STT)
 * - outbound pipeline (chunker → TTS)
 * - message history
 * - interruption state machine
 */
export class Session {
  readonly id: string;
  readonly history = new MessageHistory();

  private state: SessionState = "idle";
  private readonly transport: Transport;
  private readonly stt: STTProvider;
  private readonly tts: TTSProvider;
  private readonly brain: Brain;
  private readonly audio: AudioConfig;
  private readonly ttsConfig: TTSConfig;
  private readonly sttConfig: STTConfig;
  private readonly sessionConfig: SessionConfig;
  private readonly metadata: Record<string, unknown>;
  private readonly onError: ((error: VoiceLineError) => void) | undefined;

  private inbound: Pipeline;
  private outbound: Pipeline;
  private unsubs: Unsubscribe[] = [];
  private turnAbort: AbortController | null = null;
  private micEnabled = true;
  private assistantMessageId: string | null = null;
  private assistantBuffer = "";
  private stateListeners = new Set<StateListener>();
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  /**
   * Serial TTS queue: sentences must synthesize/send in order.
   * Fire-and-forget parallel TTS was reordering audio when shorter
   * later sentences finished first.
   */
  private ttsTail: Promise<void> = Promise.resolve();
  /**
   * Monotonic audio epoch. Bumped on every interrupt / turn teardown so
   * in-flight TTS work from a previous turn can never send audio again.
   */
  private ttsGeneration = 0;
  /**
   * Epoch owned by the turn currently allowed to push outbound audio.
   * Captured at turn start; late tokens from an aborted turn must not
   * re-bind to a newer generation (that was the barge-in regression).
   */
  private outboundEpoch = -1;
  /** Watchdog timer: if we stay in `processing` too long, snap back to listening. */
  private processingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Max ms we allow `processing` state before forcibly recovering. */
  private static readonly PROCESSING_TIMEOUT_MS = 8_000;
  /** Max ms to wait for in-flight work during close before force-teardown. */
  private static readonly CLOSE_DRAIN_MS = 2_000;
  /**
   * Serializes inbound audio through VAD/STT. Concurrent `push` races corrupt
   * VAD state; always chain through this.
   */
  private inboundChain: Promise<void> = Promise.resolve();
  /** Active brain turn — awaited (with timeout) on close so teardown is clean. */
  private activeTurn: Promise<void> = Promise.resolve();
  /** True while close() is running — suppresses late error/event side effects. */
  private closing = false;
  /**
   * Per-turn TTS abort. Shared providers must not use global abort() —
   * only this signal cancels synthesis for the active turn on this session.
   */
  private ttsTurnAbort: AbortController | null = null;

  constructor(options: SessionOptions) {
    this.id = options.id ?? createId("ses");
    this.transport = options.transport;
    this.stt = options.stt;
    this.tts = options.tts;
    this.brain = options.brain;
    this.audio = { ...DEFAULT_AUDIO_CONFIG, ...options.audio };
    this.ttsConfig = {
      sampleRate: this.audio.sampleRate,
      format: this.audio.audioFormat,
      ...options.ttsConfig,
    };
    this.sttConfig = {
      sampleRate: this.audio.sampleRate,
      encoding: "pcm_s16le",
      ...options.sttConfig,
    };
    this.sessionConfig = { ...DEFAULT_SESSION_CONFIG, ...options.session };
    this.metadata = options.metadata ?? {};
    this.onError = options.onError;

    if (options.onStateChange) {
      this.stateListeners.add(options.onStateChange);
    }

    const vadConfig = { ...DEFAULT_VAD_CONFIG, ...options.vad };
    const chunkerConfig = { ...DEFAULT_CHUNKER_CONFIG, ...options.chunker };

    this.inbound = new Pipeline([
      new VADProcessor(vadConfig),
      new STTProcessor({
        provider: this.stt,
        config: this.sttConfig,
        onTranscript: (frame) => {
          this.safeVoid(this.handleTranscript(frame));
        },
        onError: (err) => this.handleError(err),
      }),
    ]);

    this.outbound = new Pipeline([new SentenceChunker(chunkerConfig)]);

    this.inbound.onFrame((frame) => {
      this.safeVoid(this.onInboundFrame(frame));
    });

    // Queue sentence frames without blocking the brain token stream.
    // Audio order is preserved by `ttsTail`. Epoch is captured at enqueue
    // time from `outboundEpoch` (the turn that is allowed to speak).
    this.outbound.onFrame((frame) => {
      if (frame.kind === "sentence") {
        this.enqueueSentence(frame.text, this.outboundEpoch);
      }
    });
  }

  get currentState(): SessionState {
    return this.state;
  }

  onStateChange(listener: StateListener): Unsubscribe {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.state !== "idle") return;

    await this.transport.connect(this.id);
    this.setState("connected");

    this.unsubs.push(
      this.transport.onAudio((chunk) => {
        if (!this.micEnabled || this.destroyed || this.closing) return;
        // Serialize so VAD never sees concurrent process() calls.
        this.inboundChain = this.inboundChain
          .then(() => {
            if (this.destroyed || this.closing) return;
            return this.inbound.push({
              kind: "audio",
              data: chunk,
              sampleRate: this.audio.sampleRate,
            });
          })
          .catch((err: unknown) => {
            this.handleError(err instanceof Error ? err : new Error(String(err)));
          });
      }),
    );

    this.unsubs.push(
      this.transport.onEvent((event) => {
        this.safeVoid(this.onClientEvent(event));
      }),
    );

    this.transport.sendEvent({ type: "session:ready", sessionId: this.id });
    this.armMaxDuration();
  }

  /**
   * Mark client ready and enter listening state.
   * Called when `client:ready` arrives, or can be forced by the server.
   */
  ready(): void {
    if (this.state === "connected" || this.state === "idle") {
      this.setState("listening");
    }
  }

  async close(): Promise<void> {
    if (this.destroyed || this.closing) return;
    this.closing = true;
    this.destroyed = true;
    this.interruptTurn();
    this.clearTimers();

    // Drain in-flight work so orphaned promises don't reject after teardown.
    // Hard-cap wait so a stuck provider can't hang close forever.
    await Promise.race([
      Promise.all([
        this.activeTurn.catch(() => {}),
        this.ttsTail.catch(() => {}),
        this.inboundChain.catch(() => {}),
      ]),
      sleep(Session.CLOSE_DRAIN_MS),
    ]);

    try {
      this.setState("closed");
    } catch {
      /* transport may already be gone */
    }

    for (const u of this.unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.unsubs = [];

    try {
      await this.inbound.destroy();
    } catch {
      /* ignore */
    }
    try {
      await this.outbound.destroy();
    } catch {
      /* ignore */
    }
    try {
      await this.transport.disconnect();
    } catch {
      /* ignore */
    }
  }

  /** Inject text as if the user typed it (bypasses STT). */
  async handleTextInput(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.destroyed) return;
    this.bumpIdle();
    await this.runBrainTurn(trimmed);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async onClientEvent(event: VoiceLineEvent): Promise<void> {
    switch (event.type) {
      case "client:ready":
        this.ready();
        break;
      case "text:send":
        await this.handleTextInput(event.text);
        break;
      case "mic:toggle":
        this.micEnabled = event.enabled;
        break;
      default:
        break;
    }
  }

  private transcriptQueue: string[] = [];
  /**
   * When true, STT finals are ignored (processing watchdog fired).
   * Cleared on the next speech_start so a new utterance can start cleanly.
   */
  private dropStaleTranscripts = false;

  private async onInboundFrame(frame: Frame): Promise<void> {
    if (frame.kind === "speech_start") {
      // New utterance — accept STT results again after a prior timeout.
      this.dropStaleTranscripts = false;
      const isBusy =
        this.state === "speaking" || this.state === "processing" || this.turnAbort !== null;
      if (isBusy) {
        if (this.sessionConfig.bargeIn === "ignore") return;
        if (this.sessionConfig.bargeIn === "queue") return;
        this.interruptTurn();
      }
      this.setState("receiving");
      return;
    }

    if (frame.kind === "speech_end") {
      if (this.state === "receiving") {
        this.setState("processing");
        // Arm a watchdog: if STT never returns a final transcript (dead silence,
        // network hiccup, Sarvam timeout) we snap back to listening automatically.
        this.armProcessingTimer();
      }
      return;
    }

    if (frame.kind === "error") {
      this.handleError(frame.error);
    }
  }

  private async handleTranscript(frame: Extract<Frame, { kind: "transcript" }>): Promise<void> {
    if (this.destroyed || this.closing) return;

    // Processing timeout already recovered — ignore late STT results from the dead stream.
    if (this.dropStaleTranscripts) return;

    if (!frame.isFinal) {
      this.safeSendEvent({ type: "transcript:partial", text: frame.text });
      return;
    }

    // Guard: empty transcript (background noise, breath, mic rustle).
    // Don't waste an LLM turn — just go back to listening.
    const trimmed = frame.text.trim();
    if (!trimmed) {
      this.clearProcessingTimer();
      if (this.state === "processing" || this.state === "receiving") {
        this.setState("listening");
      }
      return;
    }

    const isBusy =
      this.state === "speaking" || this.state === "processing" || this.turnAbort !== null;

    if (isBusy) {
      if (this.sessionConfig.bargeIn === "ignore") return;
      if (this.sessionConfig.bargeIn === "queue") {
        const userMsg = this.history.addUser(trimmed);
        this.safeSendEvent({
          type: "transcript:final",
          text: trimmed,
          messageId: userMsg.id,
        });
        this.transcriptQueue.push(trimmed);
        return;
      }
    }

    await this.runBrainTurn(trimmed);
  }

  private async runBrainTurn(userText: string, alreadyInHistory = false): Promise<void> {
    if (this.destroyed || this.closing) return;

    const turn = this.executeBrainTurn(userText, alreadyInHistory);
    // Track for close() drain; swallow so activeTurn never becomes a rejection source.
    this.activeTurn = turn.catch((err: unknown) => {
      this.handleError(err instanceof Error ? err : new Error(String(err)));
    });
    await turn;
  }

  private async executeBrainTurn(userText: string, alreadyInHistory: boolean): Promise<void> {
    // A real turn is starting — clear the processing watchdog so it doesn't fire.
    this.clearProcessingTimer();
    this.interruptTurn();

    if (!alreadyInHistory) {
      const userMsg = this.history.addUser(userText);
      this.safeSendEvent({
        type: "transcript:final",
        text: userText,
        messageId: userMsg.id,
      });
    }

    this.setState("processing");
    this.turnAbort = new AbortController();
    const signal = this.turnAbort.signal;
    // Fresh TTS scope for this turn (interruptTurn cleared the previous one).
    this.ttsTurnAbort = new AbortController();
    // Own this turn's audio epoch. Late tokens from a prior aborted turn
    // close over a different epoch and cannot reattach after barge-in.
    const turnGen = this.ttsGeneration;
    this.outboundEpoch = turnGen;

    this.assistantMessageId = createId("msg");
    this.assistantBuffer = "";

    const ctx: BrainContext = {
      sessionId: this.id,
      history: this.history.all,
      interrupt: () => this.interruptTurn(),
      signal,
      metadata: this.metadata,
    };

    try {
      const stream = brainToStream(this.brain(userText, ctx));
      this.setState("speaking");

      for await (const token of stream) {
        // Epoch check is required: abort alone is not enough if a token was
        // already past the signal check when interrupt ran, or if a new turn
        // has already claimed outboundEpoch.
        if (signal.aborted || this.destroyed || turnGen !== this.ttsGeneration) break;
        this.assistantBuffer += token;
        this.safeSendEvent({
          type: "bot:text:delta",
          delta: token,
          messageId: this.assistantMessageId!,
        });
        await this.outbound.push({ kind: "text", text: token });
      }

      if (!signal.aborted && turnGen === this.ttsGeneration && !this.destroyed) {
        await this.outbound.push({ kind: "flush" });
        await this.ttsTail.catch(() => {});
      }

      // Interrupted and partial already finalized by interruptTurn.
      if (turnGen !== this.ttsGeneration) {
        return;
      }

      if (this.assistantMessageId) {
        const partial = signal.aborted;
        this.history.addAssistant(this.assistantBuffer, {
          id: this.assistantMessageId,
          partial,
        });
        this.safeSendEvent({
          type: "bot:text:done",
          text: this.assistantBuffer,
          messageId: this.assistantMessageId,
          partial,
        });
        this.assistantMessageId = null;
        this.assistantBuffer = "";
      }

      if (!this.destroyed && !this.closing) {
        if (this.state === "speaking" || this.state === "processing") {
          this.setState("listening");
        }
      }
    } catch (err) {
      if (!signal.aborted && turnGen === this.ttsGeneration && !this.destroyed) {
        this.handleError(err instanceof Error ? err : new Error(String(err)));
        if (!this.destroyed && !this.closing) this.setState("listening");
      }
    } finally {
      // Only the active turn may clear shared turn fields / drain the queue.
      if (turnGen === this.ttsGeneration) {
        this.turnAbort = null;
        this.assistantMessageId = null;
        this.assistantBuffer = "";
        this.outboundEpoch = -1;
        this.outbound.reset();
        if (!this.destroyed && !this.closing) {
          this.bumpIdle();

          if (this.transcriptQueue.length > 0) {
            const nextPrompt = this.transcriptQueue.join("\n");
            this.transcriptQueue = [];
            this.safeVoid(this.runBrainTurn(nextPrompt, true));
          }
        }
      }
    }
  }

  /**
   * Append a sentence to the serial TTS queue.
   * Brain tokens keep flowing; audio is always sent in sentence order.
   * `epoch` is the turn that produced this sentence — never the live counter.
   */
  private enqueueSentence(text: string, epoch: number): void {
    if (epoch < 0 || epoch !== this.ttsGeneration || this.destroyed) return;

    // Pass turn-scoped signal only — never rely on provider-global abort().
    const ttsConfig: TTSConfig = {
      ...this.ttsConfig,
      ...(this.ttsTurnAbort ? { signal: this.ttsTurnAbort.signal } : {}),
    };
    const stream = eagerStream(this.tts.synthesize(text, ttsConfig));
    this.ttsTail = this.ttsTail
      .then(async () => {
        if (epoch !== this.ttsGeneration || this.destroyed) return;

        for await (const chunk of stream) {
          if (epoch !== this.ttsGeneration || this.destroyed) break;
          try {
            this.transport.sendAudio(chunk.data);
          } catch (err) {
            this.handleError(err instanceof Error ? err : new Error(String(err)));
            break;
          }
        }
      })
      .catch((err: unknown) => {
        if (epoch !== this.ttsGeneration || this.destroyed || this.closing) return;
        this.handleError(err instanceof Error ? err : new Error(String(err)));
      });
  }

  /**
   * Interrupt current turn in a single synchronous tick:
   * abort brain, abort this session's TTS turn, drop queue, notify client.
   * Does NOT call `tts.abort()` — that would cancel other sessions sharing the provider.
   */
  private interruptTurn(): void {
    if (this.turnAbort) {
      this.turnAbort.abort();
      this.turnAbort = null;
    }
    if (this.ttsTurnAbort) {
      try {
        this.ttsTurnAbort.abort();
      } catch {
        /* ignore */
      }
      this.ttsTurnAbort = null;
    }
    // Invalidate every in-flight TTS item and revoke outbound ownership.
    this.ttsGeneration += 1;
    this.outboundEpoch = -1;
    // Keep the prior chain attached so its rejection is always handled, but
    // stop awaiting it for new work — epoch guards make old items no-ops.
    const prior = this.ttsTail;
    this.ttsTail = Promise.resolve();
    void prior.catch(() => {});
    this.outbound.reset();
    this.safeSendEvent({ type: "audio:flush" });

    if (this.assistantMessageId && this.assistantBuffer.length > 0) {
      this.history.addAssistant(this.assistantBuffer, {
        id: this.assistantMessageId,
        partial: true,
      });
      this.safeSendEvent({
        type: "bot:text:done",
        text: this.assistantBuffer,
        messageId: this.assistantMessageId,
        partial: true,
      });
      this.assistantMessageId = null;
      this.assistantBuffer = "";
    }
  }

  private setState(next: SessionState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.safeSendEvent({ type: "state:change", state: next });
    for (const listener of this.stateListeners) {
      try {
        listener(next, prev);
      } catch (err) {
        // Listener errors must not kill the session state machine.
        if (!this.closing && !this.destroyed) {
          this.onError?.(toVoiceLineError("ERR_INTERNAL", err));
        }
      }
    }
  }

  private handleError(error: unknown): void {
    if (this.closing || this.destroyed) return;
    const vle = toVoiceLineError("ERR_INTERNAL", error);
    try {
      this.onError?.(vle);
    } catch {
      /* ignore */
    }
    this.safeSendEvent({
      type: "error",
      error: { code: vle.code, message: vle.message },
    });
  }

  /** Fire-and-forget with guaranteed rejection handling. */
  private safeVoid(p: Promise<unknown>): void {
    void p.catch((err: unknown) => {
      this.handleError(err instanceof Error ? err : new Error(String(err)));
    });
  }

  private safeSendEvent(event: VoiceLineEvent): void {
    if (this.destroyed && event.type !== "state:change") return;
    try {
      this.transport.sendEvent(event);
    } catch {
      /* transport may already be closed during teardown */
    }
  }

  private armMaxDuration(): void {
    this.clearTimers();
    this.maxDurationTimer = setTimeout(() => {
      this.safeVoid(this.close());
    }, this.sessionConfig.maxDurationMs);
    this.bumpIdle();
  }

  private bumpIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.safeVoid(this.close());
    }, this.sessionConfig.idleTimeoutMs);
  }

  private armProcessingTimer(): void {
    this.clearProcessingTimer();
    this.processingTimer = setTimeout(() => {
      // Only fire if we're still stuck in processing — i.e. the STT never resolved.
      if ((this.state === "processing" || this.state === "receiving") && !this.destroyed) {
        // Drop late finals from the hung STT stream and tear it down so we
        // don't surprise-start a brain turn after UI already recovered.
        this.dropStaleTranscripts = true;
        try {
          this.inbound.reset();
        } catch {
          /* ignore */
        }
        this.setState("listening");
      }
      this.processingTimer = null;
    }, Session.PROCESSING_TIMEOUT_MS);
  }

  private clearProcessingTimer(): void {
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.clearProcessingTimer();
    this.maxDurationTimer = null;
    this.idleTimer = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
