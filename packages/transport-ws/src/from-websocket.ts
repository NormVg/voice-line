import type { Transport, TransportState, Unsubscribe, VoiceLineEvent } from "@voice-line/core";
import {
  attachSocket,
  DEFAULT_MAX_BUFFERED_BYTES,
  sendAudio,
  sendEvent,
  WS_OPEN,
  type AudioHandler,
  type EventHandler,
  type WebSocketLike,
} from "./socket.js";

export interface FromWebSocketOptions {
  /**
   * Called when the remote peer closes the socket.
   * Useful for tearing down the Session on the server.
   */
  onClose?: () => void;
  onError?: (error: Error) => void;
  /**
   * Drop outbound audio when the socket buffer exceeds this many bytes.
   * Default 256KB. Set 0 to disable.
   */
  maxBufferedBytes?: number;
}

/**
 * Wrap an already-open (or opening) WebSocket as a Transport.
 *
 * This is the **server-side** path: accept a connection, wrap the socket,
 * pass the transport into `Session` / `createServer`.
 *
 * ```ts
 * wss.on('connection', async (socket) => {
 *   const transport = fromWebSocket(socket, {
 *     onClose: () => session.close(),
 *   })
 *   const session = new Session({ transport, stt, tts, brain })
 *   await session.start()
 * })
 * ```
 *
 * Wire protocol (same as client):
 * - Binary frames → audio
 * - Text frames → JSON `VoiceLineEvent`
 */
export function fromWebSocket(
  socket: WebSocketLike,
  options: FromWebSocketOptions = {},
): Transport {
  return new BoundWebSocketTransport(socket, options);
}

class BoundWebSocketTransport implements Transport {
  private stateValue: TransportState;
  private readonly socket: WebSocketLike;
  private readonly maxBufferedBytes: number;
  private readonly audioHandlers = new Set<AudioHandler>();
  private readonly eventHandlers = new Set<EventHandler>();
  private dispose: (() => void) | null = null;
  private closed = false;

  constructor(socket: WebSocketLike, options: FromWebSocketOptions) {
    this.socket = socket;
    this.maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.stateValue = socket.readyState === WS_OPEN ? "connected" : "connecting";

    const finishOpen = () => {
      if (!this.closed) this.stateValue = "connected";
    };

    if (socket.readyState === WS_OPEN) {
      // already open
    } else if (typeof socket.once === "function") {
      socket.once("open", finishOpen);
    } else if (typeof socket.addEventListener === "function") {
      socket.addEventListener("open", finishOpen);
    }

    this.dispose = attachSocket(socket, {
      onAudio: (chunk) => {
        for (const h of this.audioHandlers) h(chunk);
      },
      onEvent: (event) => {
        for (const h of this.eventHandlers) h(event);
      },
      onClose: () => {
        this.stateValue = "disconnected";
        options.onClose?.();
      },
      onError: (err) => {
        options.onError?.(err);
      },
    });
  }

  get state(): TransportState {
    return this.stateValue;
  }

  /**
   * No-op connect for an already-bound socket.
   * Session always calls connect(sessionId) — we just mark connected.
   */
  async connect(_sessionId: string): Promise<void> {
    if (this.closed) throw new Error("Transport already disconnected");
    if (this.socket.readyState === WS_OPEN) {
      this.stateValue = "connected";
      return;
    }
    // Wait briefly for open if still connecting
    if (this.stateValue === "connecting") {
      await waitForOpen(this.socket);
      this.stateValue = "connected";
    }
  }

  async disconnect(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.dispose?.();
    this.dispose = null;
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
    this.stateValue = "disconnected";
    this.audioHandlers.clear();
    this.eventHandlers.clear();
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (this.stateValue !== "connected") return;
    sendAudio(this.socket, chunk, { maxBufferedBytes: this.maxBufferedBytes });
  }

  onAudio(handler: AudioHandler): Unsubscribe {
    this.audioHandlers.add(handler);
    return () => {
      this.audioHandlers.delete(handler);
    };
  }

  sendEvent(event: VoiceLineEvent): void {
    if (this.stateValue !== "connected") return;
    sendEvent(this.socket, event);
  }

  onEvent(handler: EventHandler): Unsubscribe {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }
}

function waitForOpen(socket: WebSocketLike, timeoutMs = 10_000): Promise<void> {
  if (socket.readyState === WS_OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket open timeout"));
    }, timeoutMs);

    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("WebSocket failed to open"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off?.("open", onOpen);
      socket.off?.("error", onError);
      socket.removeEventListener?.("open", onOpen);
      socket.removeEventListener?.("error", onError);
    };

    if (typeof socket.once === "function") {
      socket.once("open", onOpen);
      socket.once("error", onError);
    } else if (typeof socket.addEventListener === "function") {
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    } else {
      clearTimeout(timer);
      reject(new Error("Cannot wait for open: no event API"));
    }
  });
}
