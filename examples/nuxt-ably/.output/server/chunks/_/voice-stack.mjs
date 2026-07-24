import { streamText } from "ai";
import { createOllama } from "ai-sdk-ollama";

var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) =>
  key in obj
    ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value })
    : (obj[key] = value);
var __publicField$1 = (obj, key, value) =>
  __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
var _a;
var DEFAULT_AUDIO_CONFIG = {
  sampleRate: 16e3,
  audioFormat: "pcm16",
  chunkDurationMs: 100,
};
var DEFAULT_VAD_CONFIG = {
  confidence: 0.4,
  // Lowered from 0.7 so quiet speech isn't treated as silence
  silenceMs: 800,
  // Increased from 400ms to allow for natural pauses
  minSpeechMs: 200,
};
var DEFAULT_CHUNKER_CONFIG = {
  maxChars: 80,
  flushOnPunctuation: true,
};
var DEFAULT_SESSION_CONFIG = {
  maxDurationMs: 18e5,
  idleTimeoutMs: 6e4,
  bargeIn: "interrupt",
};
async function* brainToStream(result) {
  const resolved = await result;
  if (typeof resolved === "string") {
    if (resolved.length > 0) yield resolved;
    return;
  }
  yield* resolved;
}
var Pipeline = class {
  constructor(processors = []) {
    __publicField$1(this, "processors");
    __publicField$1(this, "listeners", /* @__PURE__ */ new Set());
    __publicField$1(this, "destroyed", false);
    this.processors = [...processors];
  }
  get stages() {
    return this.processors;
  }
  use(processor) {
    this.processors.push(processor);
    return this;
  }
  onFrame(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async push(frame) {
    if (this.destroyed) return;
    let current = [frame];
    for (const processor of this.processors) {
      const next = [];
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
  reset() {
    var _a2;
    for (const p of this.processors) {
      (_a2 = p.reset) == null ? void 0 : _a2.call(p);
    }
  }
  async destroy() {
    var _a2;
    this.destroyed = true;
    this.listeners.clear();
    for (const p of this.processors) {
      await ((_a2 = p.destroy) == null ? void 0 : _a2.call(p));
    }
    this.processors.length = 0;
  }
  async emit(frame) {
    for (const listener of this.listeners) {
      await listener(frame);
    }
  }
};
function pcm16ToFloat32(pcm) {
  const view = new DataView(pcm);
  const out = new Float32Array(pcm.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    const int16 = view.getInt16(i * 2, true);
    out[i] = int16 / (int16 < 0 ? 32768 : 32767);
  }
  return out;
}
function rmsEnergy(samples) {
  var _a2;
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = (_a2 = samples[i]) != null ? _a2 : 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}
function pcm16ToWav(pcm, sampleRate, channels = 1) {
  const dataLength = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm));
  return buffer;
}
var VADProcessor = class {
  constructor(config = {}) {
    __publicField$1(this, "name", "vad");
    __publicField$1(this, "config");
    __publicField$1(this, "speaking", false);
    __publicField$1(this, "silenceAccumMs", 0);
    __publicField$1(this, "speechAccumMs", 0);
    __publicField$1(this, "buffer", []);
    __publicField$1(this, "sampleRate", 16e3);
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }
  process(frame) {
    if (frame.kind === "flush") {
      return this.flush();
    }
    if (frame.kind !== "audio") {
      return frame;
    }
    this.sampleRate = frame.sampleRate;
    const samples = pcm16ToFloat32(frame.data);
    const energy = rmsEnergy(samples);
    const confidence = Math.min(1, energy * 8);
    const chunkMs = (samples.length / frame.sampleRate) * 1e3;
    this.buffer.push(frame.data);
    if (!this.speaking) {
      if (confidence >= this.config.confidence) {
        this.speechAccumMs += chunkMs;
        if (this.speechAccumMs >= this.config.minSpeechMs) {
          this.speaking = true;
          this.silenceAccumMs = 0;
          const frames = [{ kind: "speech_start" }];
          for (const b of this.buffer) {
            frames.push({ kind: "audio", data: b, sampleRate: this.sampleRate });
          }
          return frames;
        }
      } else {
        this.speechAccumMs = 0;
        if (this.buffer.length > 5) {
          this.buffer = this.buffer.slice(-3);
        }
      }
      return null;
    }
    if (confidence < this.config.confidence) {
      this.silenceAccumMs += chunkMs;
      if (this.silenceAccumMs >= this.config.silenceMs) {
        return this.endSpeech();
      }
    } else {
      this.silenceAccumMs = 0;
    }
    return frame;
  }
  reset() {
    this.speaking = false;
    this.silenceAccumMs = 0;
    this.speechAccumMs = 0;
    this.buffer = [];
  }
  endSpeech() {
    const audio = concatBuffers(this.buffer);
    this.speaking = false;
    this.silenceAccumMs = 0;
    this.speechAccumMs = 0;
    this.buffer = [];
    return [
      {
        kind: "speech_end",
        audio,
        sampleRate: this.sampleRate,
      },
    ];
  }
  flush() {
    if (this.speaking && this.buffer.length > 0) {
      return this.endSpeech();
    }
    this.reset();
    return { kind: "flush" };
  }
};
function concatBuffers(chunks) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(new Uint8Array(c), offset);
    offset += c.byteLength;
  }
  return out.buffer;
}
var SENTENCE_END = /[.!?…,;:…。！？،、，\n]/u;
var SentenceChunker = class {
  constructor(config = {}) {
    __publicField$1(this, "name", "sentence-chunker");
    __publicField$1(this, "config");
    __publicField$1(this, "buffer", "");
    this.config = { ...DEFAULT_CHUNKER_CONFIG, ...config };
  }
  process(frame) {
    if (frame.kind === "flush") {
      return this.flushRemainder();
    }
    if (frame.kind !== "text") {
      return frame;
    }
    this.buffer += frame.text;
    const sentences = [];
    if (this.config.flushOnPunctuation) {
      let match;
      while ((match = SENTENCE_END.exec(this.buffer)) !== null) {
        const end = match.index + match[0].length;
        const chunk = this.buffer.slice(0, end).trim();
        if (chunk.length > 0) {
          sentences.push({ kind: "sentence", text: chunk });
        }
        this.buffer = this.buffer.slice(end);
        SENTENCE_END.lastIndex = 0;
      }
    }
    while (this.buffer.length >= this.config.maxChars) {
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
  reset() {
    this.buffer = "";
  }
  flushRemainder() {
    const out = [];
    const rem = this.buffer.trim();
    if (rem.length > 0) {
      out.push({ kind: "sentence", text: rem });
    }
    this.buffer = "";
    out.push({ kind: "flush" });
    return out;
  }
};
var STTProcessor = class {
  constructor(options) {
    __publicField$1(this, "name", "stt");
    __publicField$1(this, "stream", null);
    __publicField$1(this, "provider");
    __publicField$1(this, "config");
    __publicField$1(this, "onTranscript");
    __publicField$1(this, "onError");
    __publicField$1(this, "unsubs", []);
    var _a2;
    this.provider = options.provider;
    this.config = (_a2 = options.config) != null ? _a2 : {};
    this.onTranscript = options.onTranscript;
    this.onError = options.onError;
  }
  process(frame) {
    var _a2, _b, _c, _d, _e;
    if (frame.kind === "speech_start") {
      void this.closeStream();
      void this.openStream();
      return frame;
    }
    if (frame.kind === "audio") {
      this.ensureStream();
      (_a2 = this.stream) == null ? void 0 : _a2.write(frame.data);
      return null;
    }
    if (frame.kind === "speech_end") {
      (_c = (_b = this.stream) == null ? void 0 : _b.flush) == null ? void 0 : _c.call(_b);
      return frame;
    }
    if (frame.kind === "flush") {
      (_e = (_d = this.stream) == null ? void 0 : _d.flush) == null ? void 0 : _e.call(_d);
      return frame;
    }
    return frame;
  }
  reset() {
    void this.closeStream();
  }
  async destroy() {
    await this.closeStream();
  }
  ensureStream() {
    if (!this.stream) {
      void this.openStream();
    }
  }
  openStream() {
    if (this.stream) return;
    this.stream = this.provider.createStream(this.config);
    this.unsubs.push(
      this.stream.on("transcript", (result) => {
        this.onTranscript({
          kind: "transcript",
          text: result.text,
          isFinal: result.isFinal,
          language: result.language,
          confidence: result.confidence,
        });
        if (result.isFinal) {
          void this.closeStream();
        }
      }),
    );
    this.unsubs.push(
      this.stream.on("error", (error) => {
        var _a2;
        (_a2 = this.onError) == null ? void 0 : _a2.call(this, error);
      }),
    );
  }
  async closeStream() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.stream) {
      await this.stream.close();
      this.stream = null;
    }
  }
};
var VoiceLineError = class _VoiceLineError extends Error {
  constructor(code, message, cause) {
    super(message);
    __publicField$1(this, "code");
    __publicField$1(this, "cause");
    this.code = code;
    this.cause = cause;
    this.name = "VoiceLineError";
    Object.setPrototypeOf(this, _VoiceLineError.prototype);
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
};
function toVoiceLineError(code, err) {
  if (err instanceof VoiceLineError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new VoiceLineError(code, message, err);
}
function createId(prefix = "") {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${rand}` : rand;
}
var MessageHistory = class {
  constructor() {
    __publicField$1(this, "messages", []);
  }
  get all() {
    return this.messages;
  }
  get length() {
    return this.messages.length;
  }
  addUser(content, id) {
    const msg = {
      id: id != null ? id : createId("msg"),
      role: "user",
      content,
      timestamp: Date.now(),
      partial: false,
    };
    this.messages.push(msg);
    return msg;
  }
  addAssistant(content, options) {
    var _a2, _b;
    const msg = {
      id: (_a2 = options == null ? void 0 : options.id) != null ? _a2 : createId("msg"),
      role: "assistant",
      content,
      timestamp: Date.now(),
      partial: (_b = options == null ? void 0 : options.partial) != null ? _b : false,
    };
    this.messages.push(msg);
    return msg;
  }
  /** Update the last assistant message (streaming accumulation). */
  updateLastAssistant(content, partial = false) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if ((m == null ? void 0 : m.role) === "assistant") {
        const updated = { ...m, content, partial, timestamp: Date.now() };
        this.messages[i] = updated;
        return updated;
      }
    }
    return null;
  }
  clear() {
    this.messages = [];
  }
  toJSON() {
    return [...this.messages];
  }
};
function eagerStream(iterable) {
  const queue = [];
  let done = false;
  const state = { resolveWaiting: null };
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
          yield item;
        } else if (done) {
          break;
        } else {
          await new Promise((resolve) => {
            state.resolveWaiting = resolve;
          });
        }
      }
    },
  };
}
var Session =
  ((_a = class {
    constructor(options) {
      __publicField$1(this, "id");
      __publicField$1(this, "history", new MessageHistory());
      __publicField$1(this, "state", "idle");
      __publicField$1(this, "transport");
      __publicField$1(this, "stt");
      __publicField$1(this, "tts");
      __publicField$1(this, "brain");
      __publicField$1(this, "audio");
      __publicField$1(this, "ttsConfig");
      __publicField$1(this, "sttConfig");
      __publicField$1(this, "sessionConfig");
      __publicField$1(this, "metadata");
      __publicField$1(this, "onError");
      __publicField$1(this, "inbound");
      __publicField$1(this, "outbound");
      __publicField$1(this, "unsubs", []);
      __publicField$1(this, "turnAbort", null);
      __publicField$1(this, "micEnabled", true);
      __publicField$1(this, "assistantMessageId", null);
      __publicField$1(this, "assistantBuffer", "");
      __publicField$1(this, "stateListeners", /* @__PURE__ */ new Set());
      __publicField$1(this, "maxDurationTimer", null);
      __publicField$1(this, "idleTimer", null);
      __publicField$1(this, "destroyed", false);
      /**
       * Serial TTS queue: sentences must synthesize/send in order.
       * Fire-and-forget parallel TTS was reordering audio when shorter
       * later sentences finished first.
       */
      __publicField$1(this, "ttsTail", Promise.resolve());
      /** Bumped on interrupt so in-flight queue items bail out. */
      __publicField$1(this, "ttsGeneration", 0);
      /** Watchdog timer: if we stay in `processing` too long, snap back to listening. */
      __publicField$1(this, "processingTimer", null);
      __publicField$1(this, "transcriptQueue", []);
      var _a2, _b;
      this.id = (_a2 = options.id) != null ? _a2 : createId("ses");
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
      this.metadata = (_b = options.metadata) != null ? _b : {};
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
      this.outbound.onFrame((frame) => {
        if (frame.kind === "sentence") {
          this.enqueueSentence(frame.text);
        }
      });
    }
    get currentState() {
      return this.state;
    }
    onStateChange(listener) {
      this.stateListeners.add(listener);
      return () => {
        this.stateListeners.delete(listener);
      };
    }
    async start() {
      if (this.state !== "idle") return;
      await this.transport.connect(this.id);
      this.setState("connected");
      let audioCount = 0;
      this.unsubs.push(
        this.transport.onAudio((chunk) => {
          audioCount++;
          if (audioCount % 10 === 0)
            console.log(
              `[session ${this.id}] Received 10 audio chunks (${chunk.byteLength} bytes each)`,
            );
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
    ready() {
      if (this.state === "connected" || this.state === "idle") {
        this.setState("listening");
      }
    }
    async close() {
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
    async handleTextInput(text) {
      const trimmed = text.trim();
      if (!trimmed || this.destroyed) return;
      this.bumpIdle();
      await this.runBrainTurn(trimmed);
    }
    // ── Internals ────────────────────────────────────────────────────────────
    async onClientEvent(event) {
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
      }
    }
    async onInboundFrame(frame) {
      if (frame.kind === "speech_start") {
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
          this.armProcessingTimer();
        }
        return;
      }
      if (frame.kind === "error") {
        this.handleError(frame.error);
      }
    }
    async handleTranscript(frame) {
      if (!frame.isFinal) {
        this.transport.sendEvent({ type: "transcript:partial", text: frame.text });
        return;
      }
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
          this.transport.sendEvent({
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
    async runBrainTurn(userText, alreadyInHistory = false) {
      if (this.destroyed) return;
      this.clearProcessingTimer();
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
      const ctx = {
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
    enqueueSentence(text) {
      const gen = this.ttsGeneration;
      const stream = eagerStream(this.tts.synthesize(text, this.ttsConfig));
      this.ttsTail = this.ttsTail
        .then(async () => {
          var _a2, _b;
          if (gen !== this.ttsGeneration || this.destroyed) return;
          if ((_a2 = this.turnAbort) == null ? void 0 : _a2.signal.aborted) return;
          for await (const chunk of stream) {
            if (gen !== this.ttsGeneration || this.destroyed) break;
            if ((_b = this.turnAbort) == null ? void 0 : _b.signal.aborted) break;
            this.transport.sendAudio(chunk.data);
          }
        })
        .catch((err) => {
          var _a2;
          if (gen !== this.ttsGeneration) return;
          if ((_a2 = this.turnAbort) == null ? void 0 : _a2.signal.aborted) return;
          this.handleError(err instanceof Error ? err : new Error(String(err)));
        });
    }
    /**
     * Interrupt current turn in a single synchronous tick:
     * abort brain, abort TTS, drop TTS queue, notify client.
     */
    interruptTurn() {
      if (this.turnAbort) {
        this.turnAbort.abort();
        this.turnAbort = null;
      }
      this.tts.abort();
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
    setState(next) {
      if (this.state === next) return;
      const prev = this.state;
      this.state = next;
      this.transport.sendEvent({ type: "state:change", state: next });
      for (const listener of this.stateListeners) {
        listener(next, prev);
      }
    }
    handleError(error) {
      var _a2;
      const vle = toVoiceLineError("ERR_INTERNAL", error);
      (_a2 = this.onError) == null ? void 0 : _a2.call(this, vle);
      this.transport.sendEvent({
        type: "error",
        error: { code: vle.code, message: vle.message },
      });
    }
    armMaxDuration() {
      this.clearTimers();
      this.maxDurationTimer = setTimeout(() => {
        void this.close();
      }, this.sessionConfig.maxDurationMs);
      this.bumpIdle();
    }
    bumpIdle() {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        void this.close();
      }, this.sessionConfig.idleTimeoutMs);
    }
    armProcessingTimer() {
      this.clearProcessingTimer();
      this.processingTimer = setTimeout(() => {
        if ((this.state === "processing" || this.state === "receiving") && !this.destroyed) {
          this.setState("listening");
        }
        this.processingTimer = null;
      }, _a.PROCESSING_TIMEOUT_MS);
    }
    clearProcessingTimer() {
      if (this.processingTimer) {
        clearTimeout(this.processingTimer);
        this.processingTimer = null;
      }
    }
    clearTimers() {
      if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.clearProcessingTimer();
      this.maxDurationTimer = null;
      this.idleTimer = null;
    }
  }) /** Max ms we allow `processing` state before forcibly recovering. */,
  __publicField$1(_a, "PROCESSING_TIMEOUT_MS", 8e3),
  _a);

function fromAISDK(options) {
  return async function* aiSdkBrain(userText, ctx) {
    var _a;
    const streamText = (_a = options.streamText) != null ? _a : await loadStreamText();
    const messages = toCoreMessages(ctx.history, userText);
    const result = streamText({
      model: options.model,
      system: options.system,
      messages,
      tools: options.tools,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      abortSignal: ctx.signal,
      ...options.extra,
    });
    for await (const delta of result.textStream) {
      if (ctx.signal.aborted) break;
      yield delta;
    }
  };
}
function toCoreMessages(history, userText) {
  const messages = [];
  for (const m of history) {
    messages.push({ role: m.role, content: m.content });
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || last.content !== userText) {
    messages.push({ role: "user", content: userText });
  }
  return messages;
}
async function loadStreamText() {
  const mod = await import("ai");
  const fn = mod.streamText;
  if (!fn) {
    throw new Error("Could not load streamText from 'ai'. Is the AI SDK installed?");
  }
  return fn;
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) =>
  key in obj
    ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value })
    : (obj[key] = value);
var __publicField = (obj, key, value) =>
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var SARVAM_BASE_URL = "https://api.sarvam.ai";
function resolveApiKey(explicit) {
  const key =
    explicit != null
      ? explicit
      : typeof process !== "undefined"
        ? process.env.SARVAM_API_KEY
        : void 0;
  if (!key) {
    throw new Error("Sarvam API key missing. Pass apiKey or set SARVAM_API_KEY.");
  }
  return key;
}
function authHeaders(apiKey) {
  return {
    "api-subscription-key": apiKey,
  };
}
var SarvamSTTStream = class {
  constructor(options, config) {
    __publicField(this, "options");
    __publicField(this, "config");
    __publicField(this, "apiKey");
    __publicField(this, "baseUrl");
    __publicField(this, "chunks", []);
    __publicField(this, "closed", false);
    __publicField(this, "ws", null);
    __publicField(this, "handlers", {
      transcript: /* @__PURE__ */ new Set(),
      error: /* @__PURE__ */ new Set(),
      speech_start: /* @__PURE__ */ new Set(),
      speech_end: /* @__PURE__ */ new Set(),
    });
    var _a;
    this.options = options;
    this.config = config;
    this.apiKey = resolveApiKey(options.apiKey);
    this.baseUrl = (_a = options.baseUrl) != null ? _a : SARVAM_BASE_URL;
  }
  write(chunk) {
    if (this.closed) return;
    this.chunks.push(chunk);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWsChunk(chunk);
    }
  }
  on(event, handler) {
    this.handlers[event].add(handler);
    return () => {
      this.handlers[event].delete(handler);
    };
  }
  flush() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "flush" }));
      return;
    }
    void this.transcribeRest();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    } else if (this.chunks.length > 0) {
      await this.transcribeRest();
    }
    this.chunks = [];
  }
  /** Open WS streaming connection (called lazily). */
  async connectStreaming() {
    var _a, _b, _c;
    if (this.ws || this.options.streaming === false) return;
    const model =
      (_b = (_a = this.config.model) != null ? _a : this.options.model) != null ? _b : "saaras:v3";
    const params = new URLSearchParams({
      "api-subscription-key": this.apiKey,
      model,
      "high-vad-sensitivity": "true",
      "flush-signal": "true",
    });
    const language = (_c = this.config.language) != null ? _c : this.options.language;
    if (language) params.set("language-code", language);
    const url = `${this.baseUrl.replace("https", "wss")}/speech-to-text/ws?${params}`;
    try {
      this.ws = new WebSocket(url);
      await new Promise((resolve, reject) => {
        if (!this.ws) return reject(new Error("WS missing"));
        this.ws.onopen = () => resolve();
        this.ws.onerror = () => reject(new Error("Sarvam STT WebSocket failed"));
      });
      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          this.handleWsMessage(msg);
        } catch (err) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      };
      for (const chunk of this.chunks) {
        this.sendWsChunk(chunk);
      }
    } catch {
      this.ws = null;
    }
  }
  sendWsChunk(chunk) {
    var _a;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const sampleRate = (_a = this.config.sampleRate) != null ? _a : 16e3;
    const b64 = arrayBufferToBase64(chunk);
    this.ws.send(
      JSON.stringify({
        audio: b64,
        encoding: "audio/wav",
        // pcm sent as raw; API also accepts pcm_s16le
        sample_rate: sampleRate,
      }),
    );
  }
  handleWsMessage(msg) {
    var _a, _b, _c, _d;
    const type = (_a = msg.type) != null ? _a : msg.event;
    if (type === "START_SPEECH" || type === "speech_start") {
      this.emit("speech_start", void 0);
      return;
    }
    if (type === "END_SPEECH" || type === "speech_end") {
      this.emit("speech_end", void 0);
      return;
    }
    const text =
      (typeof msg.transcript === "string" && msg.transcript) ||
      (typeof msg.text === "string" && msg.text) ||
      "";
    if (!text) return;
    const isFinal =
      msg.is_final === true ||
      msg.isFinal === true ||
      type === "transcript" ||
      msg.status === "final";
    const result = {
      text,
      isFinal: Boolean(isFinal),
      language: String(
        (_d =
          (_c = (_b = msg.language_code) != null ? _b : msg.language) != null
            ? _c
            : this.options.language) != null
          ? _d
          : "unknown",
      ),
      confidence: typeof msg.confidence === "number" ? msg.confidence : 1,
    };
    this.emit("transcript", result);
  }
  async transcribeRest() {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (this.chunks.length === 0) return;
    const sampleRate = (_a = this.config.sampleRate) != null ? _a : 16e3;
    const pcm = concat(this.chunks);
    this.chunks = [];
    const wav = pcm16ToWav(pcm, sampleRate);
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
      form.append(
        "model",
        (_c = (_b = this.config.model) != null ? _b : this.options.model) != null
          ? _c
          : "saaras:v3",
      );
      form.append("mode", (_d = this.options.mode) != null ? _d : "transcribe");
      const language = (_e = this.config.language) != null ? _e : this.options.language;
      if (language) form.append("language_code", language);
      const res = await fetch(`${this.baseUrl}/speech-to-text`, {
        method: "POST",
        headers: authHeaders(this.apiKey),
        body: form,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Sarvam STT ${res.status}: ${body}`);
      }
      const json = await res.json();
      const text = (_f = json.transcript) != null ? _f : "";
      if (text) {
        this.emit("transcript", {
          text,
          isFinal: true,
          language:
            (_h = (_g = json.language_code) != null ? _g : language) != null ? _h : "unknown",
          confidence: 1,
        });
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }
  emit(event, payload) {
    for (const h of this.handlers[event]) {
      h(payload);
    }
  }
};
var SarvamSTTProvider = class {
  constructor(options = {}) {
    __publicField(this, "options");
    this.options = options;
  }
  createStream(config) {
    const stream = new SarvamSTTStream(this.options, config);
    if (this.options.streaming !== false) {
      void stream.connectStreaming();
    }
    return stream;
  }
};
function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(new Uint8Array(c), offset);
    offset += c.byteLength;
  }
  return out.buffer;
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}
var SarvamTTSProvider = class {
  constructor(options = {}) {
    __publicField(this, "options");
    __publicField(this, "apiKey");
    __publicField(this, "baseUrl");
    __publicField(this, "abortController", null);
    var _a;
    this.options = options;
    this.apiKey = resolveApiKey(options.apiKey);
    this.baseUrl = (_a = options.baseUrl) != null ? _a : SARVAM_BASE_URL;
  }
  async *synthesize(text, config) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const body = {
      text: trimmed,
      target_language_code:
        (_b = (_a = config.language) != null ? _a : this.options.language) != null ? _b : "en-IN",
      model:
        (_d = (_c = config.model) != null ? _c : this.options.model) != null ? _d : "bulbul:v3",
      speaker: (_f = (_e = config.voice) != null ? _e : this.options.voice) != null ? _f : "shubh",
      pace: (_h = (_g = config.pace) != null ? _g : this.options.pace) != null ? _h : 1,
      speech_sample_rate: String(
        (_j = (_i = config.sampleRate) != null ? _i : this.options.sampleRate) != null ? _j : 16e3,
      ),
    };
    try {
      const streamRes = await fetch(`${this.baseUrl}/text-to-speech/stream`, {
        method: "POST",
        headers: {
          ...authHeaders(this.apiKey),
          "Content-Type": "application/json",
          Accept: "audio/wav, application/octet-stream",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (streamRes.ok && streamRes.body) {
        yield* this.readStream(streamRes.body, config);
        return;
      }
      const res = await fetch(`${this.baseUrl}/text-to-speech`, {
        method: "POST",
        headers: {
          ...authHeaders(this.apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Sarvam TTS ${res.status}: ${errBody}`);
      }
      const json = await res.json();
      const b64 = (_k = json.audios) == null ? void 0 : _k[0];
      if (!b64) return;
      let data = base64ToArrayBuffer(b64);
      const view = new Uint8Array(data);
      if (
        view.length >= 44 &&
        view[0] === 82 && // R
        view[1] === 73 && // I
        view[2] === 70 && // F
        view[3] === 70
      ) {
        data = data.slice(44);
      }
      yield {
        data,
        sampleRate:
          (_m = (_l = config.sampleRate) != null ? _l : this.options.sampleRate) != null
            ? _m
            : 16e3,
        format: (_n = config.format) != null ? _n : "pcm16",
      };
    } catch (err) {
      if (signal.aborted) return;
      throw err;
    } finally {
      this.abortController = null;
    }
  }
  abort() {
    var _a;
    (_a = this.abortController) == null ? void 0 : _a.abort();
    this.abortController = null;
  }
  async *readStream(body, config) {
    var _a, _b, _c;
    const reader = body.getReader();
    const sampleRate =
      (_b = (_a = config.sampleRate) != null ? _a : this.options.sampleRate) != null ? _b : 16e3;
    let pending = new Uint8Array(0);
    let headerHandled = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        let currentChunk = value;
        if (!headerHandled) {
          headerHandled = true;
          if (
            currentChunk.length >= 4 &&
            currentChunk[0] === 82 && // R
            currentChunk[1] === 73 && // I
            currentChunk[2] === 70 && // F
            currentChunk[3] === 70
          ) {
            const headerSize = 44;
            if (currentChunk.length <= headerSize) continue;
            currentChunk = currentChunk.subarray(headerSize);
          }
        }
        const totalLength = pending.length + currentChunk.length;
        const validBytes = totalLength - (totalLength % 2);
        if (validBytes === 0) {
          const newPending = new Uint8Array(totalLength);
          newPending.set(pending);
          newPending.set(currentChunk, pending.length);
          pending = newPending;
          continue;
        }
        const toYield = new Uint8Array(validBytes);
        const nextPending = new Uint8Array(totalLength - validBytes);
        if (pending.length > 0) {
          toYield.set(pending);
          toYield.set(currentChunk.subarray(0, validBytes - pending.length), pending.length);
          nextPending.set(currentChunk.subarray(validBytes - pending.length));
        } else {
          toYield.set(currentChunk.subarray(0, validBytes));
          nextPending.set(currentChunk.subarray(validBytes));
        }
        pending = nextPending;
        yield {
          data: toYield.buffer,
          sampleRate,
          format: (_c = config.format) != null ? _c : "pcm16",
        };
      }
    } finally {
      reader.releaseLock();
    }
  }
};
function base64ToArrayBuffer(b64) {
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.buffer;
  }
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
var sarvam = {
  stt(options = {}) {
    return new SarvamSTTProvider(options);
  },
  tts(options = {}) {
    return new SarvamTTSProvider(options);
  },
};

function createVoiceStack(env) {
  const warnings = [];
  const ready = { stt: false, tts: false, brain: false };
  if (!env.sarvamApiKey) {
    warnings.push("SARVAM_API_KEY missing \u2014 STT/TTS will fail until set.");
  } else {
    ready.stt = true;
    ready.tts = true;
  }
  if (!env.ollamaApiKey) {
    warnings.push("OLLAMA_API_KEY missing \u2014 brain will use a local echo fallback.");
  } else {
    ready.brain = true;
  }
  const stt = sarvam.stt({
    apiKey: env.sarvamApiKey || void 0,
    language: "unknown",
    model: "saaras:v3",
    mode: "transcribe",
    streaming: true,
  });
  const tts = sarvam.tts({
    apiKey: env.sarvamApiKey || void 0,
    voice: "shubh",
    language: "en-IN",
    model: "bulbul:v3",
    sampleRate: 16e3,
  });
  let brain;
  if (env.ollamaApiKey) {
    const ollama = createOllama({
      apiKey: env.ollamaApiKey,
      baseURL: env.ollamaBaseUrl || "https://ollama.com",
    });
    const modelName = env.ollamaModel || "gemma4:31b-cloud";
    brain = fromAISDK({
      model: ollama(modelName),
      system: [
        "You are a helpful voice assistant.",
        "Keep answers short and conversational \u2014 ideally 1\u20133 sentences.",
        "Do not use markdown, bullet lists, or code blocks unless asked.",
        "Speak naturally; the user is listening, not reading.",
      ].join(" "),
      temperature: 0.7,
      streamText: (opts) =>
        streamText({
          model: opts.model,
          system: opts.system,
          messages: opts.messages,
          temperature: opts.temperature,
          abortSignal: opts.abortSignal,
          tools: opts.tools,
        }),
    });
  } else {
    brain = async function* echoBrain(userText) {
      yield `You said: ${userText}. `;
      yield "Set OLLAMA_API_KEY to enable the Ollama Cloud brain.";
    };
  }
  return { stt, tts, brain, ready, warnings };
}

export { Session as S, createVoiceStack as c };
//# sourceMappingURL=voice-stack.mjs.map
