import type { Transport, TransportState, Unsubscribe, VoiceLineEvent } from "@voice-line/core";
import {
  attachSocket,
  sendAudio,
  sendEvent,
  type AudioHandler,
  type EventHandler,
  type WebSocketLike,
} from "./socket.js";

export interface WsTransportOptions {
  /**
   * WebSocket URL factory. Receives sessionId.
   * Example: `(id) => \`wss://api.example.com/voice?session=${id}\``
   */
  url: string | ((sessionId: string) => string);
  /**
   * Optional WebSocket implementation (Node `ws` package).
   * Defaults to global `WebSocket` (browsers / Node 22+).
   */
  WebSocketImpl?: new (
    url: string,
    protocols?: string | string[],
  ) => WebSocketLike;
  protocols?: string | string[];
}

/**
 * Client-side raw WebSocket transport.
 *
 * Wire protocol:
 * - Binary frames → audio
 * - Text frames → JSON VoiceLineEvent
 *
 * ```ts
 * const transport = new WsTransport({
 *   url: (id) => `ws://localhost:3001/voice?session=${id}`,
 *   WebSocketImpl: WebSocket, // from 'ws' in Node
 * })
 * await transport.connect(sessionId)
 * ```
 */
export class WsTransport implements Transport {
  private stateValue: TransportState = "idle";
  private ws: WebSocketLike | null = null;
  private readonly options: WsTransportOptions;
  private readonly audioHandlers = new Set<AudioHandler>();
  private readonly eventHandlers = new Set<EventHandler>();
  private dispose: (() => void) | null = null;
  private sessionId: string | null = null;

  constructor(options: WsTransportOptions) {
    this.options = options;
  }

  get state(): TransportState {
    return this.stateValue;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  async connect(sessionId: string): Promise<void> {
    if (this.stateValue === "connected" || this.stateValue === "connecting") {
      return;
    }
    this.sessionId = sessionId;
    this.stateValue = "connecting";

    const url =
      typeof this.options.url === "function" ? this.options.url(sessionId) : this.options.url;

    const WS = this.options.WebSocketImpl ?? globalThis.WebSocket;
    if (!WS) {
      throw new Error(
        "No WebSocket implementation available. Pass WebSocketImpl (e.g. from 'ws').",
      );
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WS(url, this.options.protocols) as WebSocketLike;
      this.ws = ws;

      let settled = false;
      const succeed = () => {
        if (settled) return;
        settled = true;
        this.stateValue = "connected";
        resolve();
      };
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        this.stateValue = "disconnected";
        reject(err instanceof Error ? err : new Error("WebSocket connection failed"));
      };

      if (typeof ws.once === "function") {
        ws.once("open", succeed);
        ws.once("error", fail);
      } else if (typeof ws.addEventListener === "function") {
        ws.addEventListener("open", succeed);
        ws.addEventListener("error", () => fail(new Error("WebSocket connection failed")));
      } else {
        fail(new Error("WebSocket has no open event API"));
        return;
      }

      this.dispose = attachSocket(ws, {
        onAudio: (chunk) => {
          for (const h of this.audioHandlers) h(chunk);
        },
        onEvent: (event) => {
          for (const h of this.eventHandlers) h(event);
        },
        onClose: () => {
          this.stateValue = "disconnected";
        },
        onError: (err) => {
          // Only fail the connect promise if still connecting
          if (this.stateValue === "connecting") fail(err);
        },
      });
    });
  }

  async disconnect(): Promise<void> {
    this.dispose?.();
    this.dispose = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.stateValue = "disconnected";
    this.audioHandlers.clear();
    this.eventHandlers.clear();
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (!this.ws || this.stateValue !== "connected") return;
    sendAudio(this.ws, chunk);
  }

  onAudio(handler: AudioHandler): Unsubscribe {
    this.audioHandlers.add(handler);
    return () => {
      this.audioHandlers.delete(handler);
    };
  }

  sendEvent(event: VoiceLineEvent): void {
    if (!this.ws || this.stateValue !== "connected") return;
    sendEvent(this.ws, event);
  }

  onEvent(handler: EventHandler): Unsubscribe {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }
}

/**
 * Factory matching project.md usage for client-side transports.
 *
 * ```ts
 * transport: ws({ url: (id) => `wss://.../${id}` })
 * ```
 *
 * Note: for **server** accept path, use `fromWebSocket(socket)` instead.
 */
export function ws(options: WsTransportOptions): (sessionId: string) => Transport {
  return () => new WsTransport(options);
}
