import { d as defineEventHandler, c as createError, r as readBody, u as useRuntimeConfig } from '../../nitro/nitro.mjs';
import { createEventHandler } from '@voice-line/server/nitro';
import { c as createVoiceStack } from '../../_/voice-stack.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'ai';
import 'ai-sdk-ollama';

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var AblyTransport = class {
  constructor(options) {
    __publicField(this, "stateValue", "idle");
    __publicField(this, "options");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __publicField(this, "client", null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __publicField(this, "channel", null);
    __publicField(this, "audioHandlers", /* @__PURE__ */ new Set());
    __publicField(this, "eventHandlers", /* @__PURE__ */ new Set());
    this.options = options;
  }
  get state() {
    return this.stateValue;
  }
  // ── Directional event routing ───────────────────────────────────────────
  // Client publishes audio:client, subscribes to audio:server (and vice versa).
  get publishAudioEvent() {
    var _a;
    return `audio:${(_a = this.options.role) != null ? _a : "server"}`;
  }
  get subscribeAudioEvent() {
    var _a;
    return ((_a = this.options.role) != null ? _a : "server") === "client" ? "audio:server" : "audio:client";
  }
  get publishJsonEvent() {
    var _a;
    return `event:${(_a = this.options.role) != null ? _a : "server"}`;
  }
  get subscribeJsonEvent() {
    var _a;
    return ((_a = this.options.role) != null ? _a : "server") === "client" ? "event:server" : "event:client";
  }
  async connect(sessionId) {
    var _a;
    if (this.stateValue === "connected" || this.stateValue === "connecting") {
      return;
    }
    this.stateValue = "connecting";
    const Realtime = (_a = this.options.Realtime) != null ? _a : await importAblyRealtime();
    const clientOptions = {};
    if (this.options.apiKey) clientOptions.key = this.options.apiKey;
    if (this.options.authUrl) clientOptions.authUrl = this.options.authUrl;
    if (this.options.authCallback) clientOptions.authCallback = this.options.authCallback;
    const realtime = new Realtime(clientOptions);
    await new Promise((resolve, reject) => {
      realtime.connection.once("connected", () => resolve());
      realtime.connection.once("failed", (err) => {
        this.stateValue = "disconnected";
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
    realtime.connection.on((stateChange) => {
      console.log(
        `[AblyTransport:${this.options.role}] Connection state changed:`,
        stateChange.current,
        stateChange.reason
      );
      if (stateChange.current === "closed" || stateChange.current === "failed" || stateChange.current === "suspended") {
        this.stateValue = "disconnected";
      }
    });
    this.client = realtime;
    const name = this.options.channelName ? this.options.channelName(sessionId) : `voice-line:${sessionId}`;
    this.channel = realtime.channels.get(name);
    await Promise.all([
      this.channel.subscribe(this.subscribeAudioEvent, (msg) => {
        const pcm = decodeAudio(msg.data);
        if (pcm) {
          for (const h of this.audioHandlers) h(pcm);
        }
      }),
      this.channel.subscribe(this.subscribeJsonEvent, (msg) => {
        console.log(`[AblyTransport:${this.options.role}] Received event`, msg.data);
        if (msg.data && typeof msg.data === "object") {
          for (const h of this.eventHandlers) h(msg.data);
        }
      })
    ]);
    console.log(`[AblyTransport:${this.options.role}] Connected and subscribed`);
    this.stateValue = "connected";
  }
  async disconnect() {
    if (this.channel) {
      this.channel.unsubscribe();
    }
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    this.channel = null;
    this.stateValue = "disconnected";
    this.audioHandlers.clear();
    this.eventHandlers.clear();
  }
  sendAudio(chunk) {
    if (!this.channel || this.stateValue !== "connected") return;
    const MAX_BYTES = 32 * 1024;
    for (let offset = 0; offset < chunk.byteLength; offset += MAX_BYTES) {
      const slice = chunk.slice(offset, offset + MAX_BYTES);
      void this.channel.publish(this.publishAudioEvent, encodeAudio(slice));
    }
  }
  onAudio(handler) {
    this.audioHandlers.add(handler);
    return () => {
      this.audioHandlers.delete(handler);
    };
  }
  sendEvent(event) {
    if (!this.channel || this.stateValue !== "connected") return;
    console.log(`[AblyTransport:${this.options.role}] Sending event`, event);
    void this.channel.publish(this.publishJsonEvent, event);
  }
  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }
};
function ably(options) {
  return async (sessionId) => {
    var _a;
    let tokenRequest;
    if (options.apiKey && (options.role === "server" || options.role === void 0)) {
      const Rest = await importAblyRest();
      const rest = new Rest(options.apiKey);
      const name = options.channelName ? options.channelName(sessionId) : `voice-line:${sessionId}`;
      tokenRequest = await rest.auth.createTokenRequest({
        clientId: `client_${sessionId}`,
        capability: {
          [name]: ["publish", "subscribe", "presence"]
        }
      });
    }
    const transport = new AblyTransport({
      ...options,
      role: (_a = options.role) != null ? _a : "server"
    });
    return {
      transport,
      clientPayload: tokenRequest ? { tokenRequest } : void 0
    };
  };
}
async function importAblyRealtime() {
  var _a, _b;
  const mod = await import('ably');
  const Realtime = (_b = mod.Realtime) != null ? _b : (_a = mod.default) == null ? void 0 : _a.Realtime;
  if (!Realtime) {
    throw new Error("Could not load ably.Realtime \u2014 is `ably` installed?");
  }
  return Realtime;
}
async function importAblyRest() {
  var _a, _b;
  const mod = await import('ably');
  const Rest = (_b = mod.Rest) != null ? _b : (_a = mod.default) == null ? void 0 : _a.Rest;
  if (!Rest) {
    throw new Error("Could not load ably.Rest \u2014 is `ably` installed?");
  }
  return Rest;
}
function encodeAudio(chunk) {
  const bytes = new Uint8Array(chunk);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const data = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return { encoding: "base64", data };
}
function decodeAudio(payload) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload;
  if (p.encoding !== "base64" || typeof p.data !== "string") return null;
  if (typeof atob === "function") {
    const binary = atob(p.data);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.buffer;
  }
  const buf = Buffer.from(p.data, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

let globalStack = null;
function getStack(config) {
  if (globalStack) return globalStack;
  globalStack = createVoiceStack({
    sarvamApiKey: String(config.sarvamApiKey || ""),
    ollamaApiKey: String(config.ollamaApiKey || ""),
    ollamaBaseUrl: String(config.ollamaBaseUrl || "https://ollama.com"),
    ollamaModel: String(config.ollamaModel || "gemma4:31b-cloud")
  });
  return globalStack;
}
const session_post = defineEventHandler(
  createEventHandler(async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const config = useRuntimeConfig();
    const ablyApiKey = config.ablyApiKey;
    if (!ablyApiKey) {
      throw createError({
        statusCode: 500,
        statusMessage: "ABLY_API_KEY is not configured on the server."
      });
    }
    const body = await readBody(event).catch(() => ({}));
    const stack = getStack(config);
    return {
      transport: ably({ apiKey: ablyApiKey }),
      stt: stack.stt,
      tts: stack.tts,
      brain: stack.brain,
      sttConfig: {
        language: "unknown",
        sampleRate: 16e3,
        encoding: "pcm_s16le",
        model: "saaras:v3"
      },
      ttsConfig: {
        voice: "shubh",
        language: "en-IN",
        sampleRate: 16e3,
        format: "pcm16",
        model: "bulbul:v3"
      },
      // Keep dynamic VAD configuration driven by the client request!
      vad: {
        confidence: Number((_b = (_a = body.vad) == null ? void 0 : _a.confidence) != null ? _b : 0.3),
        silenceMs: Number((_d = (_c = body.vad) == null ? void 0 : _c.silenceMs) != null ? _d : 1e3),
        minSpeechMs: Number((_f = (_e = body.vad) == null ? void 0 : _e.minSpeechMs) != null ? _f : 200)
      },
      session: {
        maxDurationMs: 30 * 60 * 1e3,
        // 30 mins
        idleTimeoutMs: 5 * 60 * 1e3,
        // 5 mins
        bargeIn: "interrupt"
      },
      onStateChange: (state, prev) => {
        console.log(`[session] ${prev} \u2192 ${state}`);
      },
      onError: (err) => {
        console.error(`[session error]`, err.message);
      }
    };
  })
);

export { session_post as default };
//# sourceMappingURL=session.post.mjs.map
