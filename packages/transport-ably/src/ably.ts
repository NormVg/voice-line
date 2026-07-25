import type { Transport, TransportState, Unsubscribe, VoiceLineEvent } from "@voice-line/core";

export interface AblyTransportOptions {
  /** Ably API key (server) or token-auth callback (client). */
  apiKey?: string;
  /** Auth URL for client-side token requests. */
  authUrl?: string;
  /** Auth callback returning a token request / token details. */
  authCallback?: (
    tokenParams: unknown,
    callback: (err: Error | null, tokenOrDetails: unknown) => void,
  ) => void;
  /**
   * Role of this transport endpoint.
   * Default is "server" for the server-side ably() factory, and "client" for createAblyClientSession().
   */
  role?: "client" | "server";
  /** Channel name factory. Default: `voice-line:{sessionId}` */
  channelName?: (sessionId: string) => string;
  /**
   * Optional Ably Realtime constructor injection (for tests / custom builds).
   * Defaults to dynamic import of `ably`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Realtime?: new (
    options: Record<string, unknown>,
  ) => any;
}

type AudioHandler = (chunk: ArrayBuffer) => void;
type EventHandler = (event: VoiceLineEvent) => void;

/**
 * Ably transport — audio and events on separate message names of one channel.
 *
 * Audio is base64-encoded in JSON (Ably message data). For production
 * high-throughput audio, prefer binary extras / multiple channels.
 */
export class AblyTransport implements Transport {
  private stateValue: TransportState = "idle";
  private readonly options: AblyTransportOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private channel: any = null;
  private audioHandlers = new Set<AudioHandler>();
  private eventHandlers = new Set<EventHandler>();

  constructor(options: AblyTransportOptions) {
    this.options = options;
  }

  get state(): TransportState {
    return this.stateValue;
  }

  // ── Directional event routing ───────────────────────────────────────────
  // Client publishes audio:client, subscribes to audio:server (and vice versa).

  private get publishAudioEvent(): string {
    return `audio:${this.options.role ?? "server"}`;
  }
  private get subscribeAudioEvent(): string {
    return (this.options.role ?? "server") === "client" ? "audio:server" : "audio:client";
  }
  private get publishJsonEvent(): string {
    return `event:${this.options.role ?? "server"}`;
  }
  private get subscribeJsonEvent(): string {
    return (this.options.role ?? "server") === "client" ? "event:server" : "event:client";
  }

  async connect(sessionId: string): Promise<void> {
    if (this.stateValue === "connected" || this.stateValue === "connecting") {
      return;
    }
    this.stateValue = "connecting";

    const Realtime = this.options.Realtime ?? (await importAblyRealtime());
    const clientOptions: Record<string, unknown> = {};
    if (this.options.apiKey) clientOptions.key = this.options.apiKey;
    if (this.options.authUrl) clientOptions.authUrl = this.options.authUrl;
    if (this.options.authCallback) clientOptions.authCallback = this.options.authCallback;

    const realtime = new Realtime(clientOptions);

    // 1. Wait for the Ably connection itself to be established.
    await new Promise<void>((resolve, reject) => {
      realtime.connection.once("connected", () => resolve());
      realtime.connection.once("failed", (err: unknown) => {
        this.stateValue = "disconnected";
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

    realtime.connection.on((stateChange: any) => {
      console.log(
        `[AblyTransport:${this.options.role}] Connection state changed:`,
        stateChange.current,
        stateChange.reason,
      );
      if (
        stateChange.current === "closed" ||
        stateChange.current === "failed" ||
        stateChange.current === "suspended"
      ) {
        this.stateValue = "disconnected";
      }
    });

    this.client = realtime;
    const name = this.options.channelName
      ? this.options.channelName(sessionId)
      : `voice-line:${sessionId}`;
    this.channel = realtime.channels.get(name);

    // 2. Wait for both subscriptions to be confirmed by the Ably service
    //    before resolving. This ensures we won't miss any messages.
    await Promise.all([
      this.channel.subscribe(this.subscribeAudioEvent, (msg: { data: unknown }) => {
        const pcm = decodeAudio(msg.data);
        if (pcm) {
          for (const h of this.audioHandlers) h(pcm);
        }
      }),
      this.channel.subscribe(this.subscribeJsonEvent, (msg: { data: unknown }) => {
        console.log(`[AblyTransport:${this.options.role}] Received event`, msg.data);
        if (msg.data && typeof msg.data === "object") {
          for (const h of this.eventHandlers) h(msg.data as VoiceLineEvent);
        }
      }),
    ]);

    console.log(`[AblyTransport:${this.options.role}] Connected and subscribed`);
    this.stateValue = "connected";
  }

  async disconnect(): Promise<void> {
    if (this.channel) {
      try {
        await this.channel.unsubscribe();
      } catch (err) {
        // ignore unsubscribe errors during teardown
      }
    }
    if (this.client) {
      try {
        await this.client.close();
      } catch (err) {
        // ignore close errors
      }
      this.client = null;
    }
    this.channel = null;
    this.stateValue = "disconnected";
    this.audioHandlers.clear();
    this.eventHandlers.clear();
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (!this.channel || this.stateValue !== "connected") return;

    // Ably has a 64KB message limit. Slice into safe 32KB chunks.
    const MAX_BYTES = 32 * 1024;
    for (let offset = 0; offset < chunk.byteLength; offset += MAX_BYTES) {
      const slice = chunk.slice(offset, offset + MAX_BYTES);
      void this.channel.publish(this.publishAudioEvent, encodeAudio(slice));
    }
  }

  onAudio(handler: AudioHandler): Unsubscribe {
    this.audioHandlers.add(handler);
    return () => {
      this.audioHandlers.delete(handler);
    };
  }

  sendEvent(event: VoiceLineEvent): void {
    if (!this.channel || this.stateValue !== "connected") return;
    console.log(`[AblyTransport:${this.options.role}] Sending event`, event);
    void this.channel.publish(this.publishJsonEvent, event);
  }

  onEvent(handler: EventHandler): Unsubscribe {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }
}

/**
 * Factory matching project.md usage:
 *
 * ```ts
 * transport: ably({ apiKey: process.env.ABLY_API_KEY })
 * ```
 */
export function ably(options: AblyTransportOptions) {
  return async (sessionId: string) => {
    let tokenRequest: unknown;

    // If we're on the server and have an apiKey, generate a token request for the client
    if (options.apiKey && (options.role === "server" || options.role === undefined)) {
      const Rest = await importAblyRest();
      const rest = new Rest(options.apiKey);
      const name = options.channelName ? options.channelName(sessionId) : `voice-line:${sessionId}`;
      
      tokenRequest = await rest.auth.createTokenRequest({
        clientId: `client_${sessionId}`,
        capability: {
          [name]: ["publish", "subscribe", "presence"],
        },
      });
    }

    const transport = new AblyTransport({
      ...options,
      role: options.role ?? "server",
    });

    return { 
      transport, 
      clientPayload: tokenRequest ? { tokenRequest } : undefined 
    };
  };
}

/**
 * Frontend helper to fetch a session token from your server and automatically
 * initialize an AblyTransport. Designed to be passed to `useVoiceAgent({ session: ... })`.
 *
 * @param authUrl The API endpoint that returns { sessionId, tokenRequest }
 * @param Realtime Optional Ably.Realtime injection (useful if dynamically imported)
 */
export function createAblyClientSession(
  authUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Realtime?: new (options: Record<string, unknown>) => any,
  body?: Record<string, unknown>,
): () => Promise<{ transport: Transport; sessionId: string }> {
  return async () => {
    const fetchOptions: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    };
    if (body) fetchOptions.body = JSON.stringify(body);

    const res = await fetch(authUrl, fetchOptions);

    if (!res.ok) {
      throw new Error(`Failed to fetch Ably session: ${res.statusText}`);
    }

    const data = await res.json();
    if (!data.sessionId || !data.tokenRequest) {
      throw new Error("Server must return { sessionId, tokenRequest }");
    }

    const transportOptions: AblyTransportOptions = {
      role: "client",
      authCallback: (_, callback) => callback(null, data.tokenRequest),
      channelName: () => `voice-line:${data.sessionId}`,
    };
    if (Realtime) transportOptions.Realtime = Realtime;

    const transport = new AblyTransport(transportOptions);

    return { transport, sessionId: data.sessionId };
  };
}

async function importAblyRealtime(): Promise<new (options: Record<string, unknown>) => unknown> {
  const mod = await import("ably");
  // ably ESM / CJS interop
  const Realtime =
    (mod as { Realtime?: new (o: Record<string, unknown>) => unknown }).Realtime ??
    (mod as { default?: { Realtime?: new (o: Record<string, unknown>) => unknown } }).default
      ?.Realtime;
  if (!Realtime) {
    throw new Error("Could not load ably.Realtime — is `ably` installed?");
  }
  return Realtime;
}

async function importAblyRest(): Promise<new (apiKey: string) => any> {
  const mod = await import("ably");
  const Rest =
    (mod as { Rest?: new (k: string) => any }).Rest ??
    (mod as { default?: { Rest?: new (k: string) => any } }).default?.Rest;
  if (!Rest) {
    throw new Error("Could not load ably.Rest — is `ably` installed?");
  }
  return Rest;
}

function encodeAudio(chunk: ArrayBuffer): { encoding: "base64"; data: string } {
  const bytes = new Uint8Array(chunk);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const data = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return { encoding: "base64", data };
}

function decodeAudio(payload: unknown): ArrayBuffer | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { encoding?: string; data?: string };
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
