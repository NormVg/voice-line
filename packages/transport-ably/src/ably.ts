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
  authCallback?: (callback: (err: Error | null, tokenOrDetails: unknown) => void) => void;
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

const AUDIO_EVENT = "vl:audio";
const JSON_EVENT = "vl:event";

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

  async connect(sessionId: string): Promise<void> {
    if (this.stateValue === "connected" || this.stateValue === "connecting") return;
    this.stateValue = "connecting";

    const Realtime = this.options.Realtime ?? (await importAblyRealtime());
    const clientOptions: Record<string, unknown> = {};
    if (this.options.apiKey) clientOptions.key = this.options.apiKey;
    if (this.options.authUrl) clientOptions.authUrl = this.options.authUrl;
    if (this.options.authCallback) clientOptions.authCallback = this.options.authCallback;

    this.client = new Realtime(clientOptions);

    await new Promise<void>((resolve, reject) => {
      this.client.connection.once("connected", () => resolve());
      this.client.connection.once("failed", (err: Error) => reject(err));
    });

    const name =
      this.options.channelName?.(sessionId) ?? `voice-line:${sessionId}`;
    this.channel = this.client.channels.get(name);

    this.channel.subscribe(AUDIO_EVENT, (msg: { data: unknown }) => {
      const buf = decodeAudio(msg.data);
      if (buf) {
        for (const h of this.audioHandlers) h(buf);
      }
    });

    this.channel.subscribe(JSON_EVENT, (msg: { data: unknown }) => {
      if (msg.data && typeof msg.data === "object") {
        const event = msg.data as VoiceLineEvent;
        for (const h of this.eventHandlers) h(event);
      }
    });

    this.stateValue = "connected";
  }

  async disconnect(): Promise<void> {
    try {
      this.channel?.unsubscribe();
      this.client?.close();
    } finally {
      this.channel = null;
      this.client = null;
      this.stateValue = "disconnected";
      this.audioHandlers.clear();
      this.eventHandlers.clear();
    }
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (!this.channel || this.stateValue !== "connected") return;
    void this.channel.publish(AUDIO_EVENT, encodeAudio(chunk));
  }

  onAudio(handler: AudioHandler): Unsubscribe {
    this.audioHandlers.add(handler);
    return () => {
      this.audioHandlers.delete(handler);
    };
  }

  sendEvent(event: VoiceLineEvent): void {
    if (!this.channel || this.stateValue !== "connected") return;
    void this.channel.publish(JSON_EVENT, event);
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
