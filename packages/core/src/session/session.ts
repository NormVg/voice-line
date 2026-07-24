import type { VoiceLineEvent } from "../events.js";
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
          await new Promise<void>(resolve => {
            state.resolveWaiting = resolve;
          });
        }
      }
    }
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
  onError?: (error: Error) => void;
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
  private readonly onError: ((error: Error) => void) | undefined;

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
  /** Bumped on interrupt so in-flight queue items bail out. */
  private ttsGeneration = 0;

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
          void this.handleTranscript(frame);
        },
        onError: (err) => this.handleError(err),
      }),
    ]);

    this.outbound = new Pipeline([new SentenceChunker(chunkerConfig)]);

    this.inbound.onFrame((frame) => {
      void this.onInboundFrame(frame);
    });

    // Queue sentence frames without blocking the brain token stream.
    // Audio order is preserved by `ttsTail`.
    this.outbound.onFrame((frame) => {
      if (frame.kind === "sentence") {
        this.enqueueSentence(frame.text);
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
        if (!this.micEnabled || this.destroyed) return;
        void this.inbound.push({
          kind: "audio",
          data: chunk,
          sampleRate: this.audio.sampleRate,
        });
      }),
    );

    this.unsubs.push(
      this.transport.onEvent((event) => {
        void this.onClientEvent(event);
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
    if (this.destroyed) return;
    this.destroyed = true;
    this.interruptTurn();
    this.clearTimers();
    this.setState("closed");

    for (const u of this.unsubs) u();
    this.unsubs = [];

    await this.inbound.destroy();
    await this.outbound.destroy();
    await this.transport.disconnect();
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

  private async onInboundFrame(frame: Frame): Promise<void> {
    if (frame.kind === "speech_start") {
      const isBusy = this.state === "speaking" || this.state === "processing" || this.turnAbort !== null;
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
      }
      return;
    }

    if (frame.kind === "error") {
      this.handleError(frame.error);
    }
  }

  private async handleTranscript(frame: Extract<Frame, { kind: "transcript" }>): Promise<void> {
    if (!frame.isFinal) {
      this.transport.sendEvent({ type: "transcript:partial", text: frame.text });
      return;
    }

    const isBusy = this.state === "speaking" || this.state === "processing" || this.turnAbort !== null;

    if (isBusy) {
      if (this.sessionConfig.bargeIn === "ignore") return;
      if (this.sessionConfig.bargeIn === "queue") {
        const userMsg = this.history.addUser(frame.text);
        this.transport.sendEvent({
          type: "transcript:final",
          text: frame.text,
          messageId: userMsg.id,
        });
        this.transcriptQueue.push(frame.text);
        return;
      }
    }

    await this.runBrainTurn(frame.text);
  }

  private async runBrainTurn(userText: string, alreadyInHistory = false): Promise<void> {
    if (this.destroyed) return;

    this.interruptTurn();

    if (!alreadyInHistory) {
      const userMsg = this.history.addUser(userText);
      this.transport.sendEvent({
        type: "transcript:final",
        text: userText,
        messageId: userMsg.id,
      });
    }

    this.setState("processing");
    this.turnAbort = new AbortController();
    const signal = this.turnAbort.signal;
    const turnGen = this.ttsGeneration;

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
        if (signal.aborted || this.destroyed) break;
        this.assistantBuffer += token;
        this.transport.sendEvent({
          type: "bot:text:delta",
          delta: token,
          messageId: this.assistantMessageId,
        });
        await this.outbound.push({ kind: "text", text: token });
      }

      if (!signal.aborted) {
        await this.outbound.push({ kind: "flush" });
        await this.ttsTail;
      }

      if (turnGen !== this.ttsGeneration && !this.assistantMessageId) {
        return;
      }

      if (this.assistantMessageId) {
        const partial = signal.aborted;
        this.history.addAssistant(this.assistantBuffer, {
          id: this.assistantMessageId,
          partial,
        });
        this.transport.sendEvent({
          type: "bot:text:done",
          text: this.assistantBuffer,
          messageId: this.assistantMessageId,
          partial,
        });
        this.assistantMessageId = null;
        this.assistantBuffer = "";
      }

      if (!this.destroyed) {
        if (this.state === "speaking" || this.state === "processing") {
          this.setState("listening");
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        this.handleError(err instanceof Error ? err : new Error(String(err)));
        if (!this.destroyed) this.setState("listening");
      }
    } finally {
      this.turnAbort = null;
      this.assistantMessageId = null;
      this.assistantBuffer = "";
      this.outbound.reset();
      this.bumpIdle();

      if (this.transcriptQueue.length > 0 && !this.destroyed) {
        const nextPrompt = this.transcriptQueue.join("\n");
        this.transcriptQueue = [];
        void this.runBrainTurn(nextPrompt, true);
      }
    }
  }

  /**
   * Append a sentence to the serial TTS queue.
   * Brain tokens keep flowing; audio is always sent in sentence order.
   */
  private enqueueSentence(text: string): void {
    const gen = this.ttsGeneration;
    const stream = eagerStream(this.tts.synthesize(text, this.ttsConfig));
    this.ttsTail = this.ttsTail
      .then(async () => {
        if (gen !== this.ttsGeneration || this.destroyed) return;
        if (this.turnAbort?.signal.aborted) return;

        for await (const chunk of stream) {
          if (gen !== this.ttsGeneration || this.destroyed) break;
          if (this.turnAbort?.signal.aborted) break;
          this.transport.sendAudio(chunk.data);
        }
      })
      .catch((err: unknown) => {
        if (gen !== this.ttsGeneration) return;
        if (this.turnAbort?.signal.aborted) return;
        this.handleError(err instanceof Error ? err : new Error(String(err)));
      });
  }

  /**
   * Interrupt current turn in a single synchronous tick:
   * abort brain, abort TTS, drop TTS queue, notify client.
   */
  private interruptTurn(): void {
    if (this.turnAbort) {
      this.turnAbort.abort();
      this.turnAbort = null;
    }
    this.tts.abort();
    // Invalidate in-flight queue items and reset the chain
    this.ttsGeneration += 1;
    this.ttsTail = Promise.resolve();
    this.outbound.reset();
    this.transport.sendEvent({ type: "audio:flush" });

    if (this.assistantMessageId && this.assistantBuffer.length > 0) {
      this.history.addAssistant(this.assistantBuffer, {
        id: this.assistantMessageId,
        partial: true,
      });
      this.transport.sendEvent({
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
    this.transport.sendEvent({ type: "state:change", state: next });
    for (const listener of this.stateListeners) {
      listener(next, prev);
    }
  }

  private handleError(error: Error): void {
    this.onError?.(error);
    this.transport.sendEvent({ type: "error", message: error.message });
  }

  private armMaxDuration(): void {
    this.clearTimers();
    this.maxDurationTimer = setTimeout(() => {
      void this.close();
    }, this.sessionConfig.maxDurationMs);
    this.bumpIdle();
  }

  private bumpIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, this.sessionConfig.idleTimeoutMs);
  }

  private clearTimers(): void {
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.maxDurationTimer = null;
    this.idleTimer = null;
  }
}
