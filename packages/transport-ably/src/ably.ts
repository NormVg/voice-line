import type {
  Transport,
  TransportState,
  Unsubscribe,
  VoiceLineEvent,
} from "@voice-line/core";

export interface AblyTransportOptions {
  /** Ably API key (server) or token-auth callback (client). */
  apiKey?: string;
  /** Auth URL for client-side token requests. */
  authUrl?: string;
  /** Auth callback returning a token request / token details. */
  authCallback?: (tokenParams: unknown, callback: (err: Error | null, tokenOrDetails: unknown) => void) => void;
  /**
   * Role of this transport endpoint.
   *
   * Pub/sub is directional:
   * - client publishes on `audio:client` / `event:client`
   * - server publishes on `audio:server` / `event:server`
   * - each side subscribes to the *other* side's events only.
   *
   * This eliminates echo without any `echoMessages` hack.
   */
  role: "client" | "server";
  /** Channel name factory. Default: `voice-line:{sessionId}` */
  channelName?: (sessionId: string) => string;
  /**
   * Optional Ably Realtime constructor injection (for tests / custom builds).
   * Defaults to dynamic import of `ably`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Realtime?: new (options: Record<string, unknown>) => any;
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
    return `audio:${this.options.role}`;
  }
  private get subscribeAudioEvent(): string {
    return this.options.role === "client" ? "audio:server" : "audio:client";
  }
  private get publishJsonEvent(): string {
    return `event:${this.options.role}`;
  }
  private get subscribeJsonEvent(): string {
    return this.options.role === "client" ? "event:server" : "event:client";
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
        if (msg.data && typeof msg.data === "object") {
          for (const h of this.eventHandlers) h(msg.data as VoiceLineEvent);
        }
      }),
    ]);

    this.stateValue = "connected";
  }

  async disconnect(): Promise<void> {
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
export function ably(
  options: AblyTransportOptions,
): (sessionId: string) => Transport {
  return () => new AblyTransport(options);
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

function encodeAudio(chunk: ArrayBuffer): { encoding: "base64"; data: string } {
  const bytes = new Uint8Array(chunk);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const data =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
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
