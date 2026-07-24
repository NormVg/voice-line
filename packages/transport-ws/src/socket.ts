import type { VoiceLineEvent } from "@voice-line/core";

/**
 * Minimal WebSocket surface shared by browsers and the Node `ws` package.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string | ArrayBuffer | Uint8Array | Buffer): void;
  close(code?: number, reason?: string): void;
  binaryType?: string;
  addEventListener?(
    type: string,
    listener: (event: { data?: unknown; type?: string }) => void,
  ): void;
  removeEventListener?(
    type: string,
    listener: (event: { data?: unknown; type?: string }) => void,
  ): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  once?(event: string, listener: (...args: unknown[]) => void): void;
}

/** Ready-state constants (same values in browser + `ws`). */
export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

export type AudioHandler = (chunk: ArrayBuffer) => void;
export type EventHandler = (event: VoiceLineEvent) => void;
export type CloseHandler = () => void;

export interface SocketHandlers {
  onAudio: AudioHandler;
  onEvent: EventHandler;
  onClose?: CloseHandler;
  onError?: (error: Error) => void;
}

/**
 * Attach protocol handlers to any WebSocket-like socket.
 * Returns a dispose function that removes listeners.
 */
export function attachSocket(socket: WebSocketLike, handlers: SocketHandlers): () => void {
  if ("binaryType" in socket) {
    socket.binaryType = "arraybuffer";
  }

  const onBrowserMessage = (ev: { data?: unknown }) => {
    dispatchIncoming(ev.data, handlers);
  };
  const onBrowserClose = () => {
    handlers.onClose?.();
  };
  const onBrowserError = () => {
    handlers.onError?.(new Error("WebSocket error"));
  };

  const onNodeMessage = (...args: unknown[]) => {
    const data = args[0];
    const isBinary = args[1] === true;
    // `ws` passes (data, isBinary). Binary may be Buffer.
    if (
      isBinary ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) ||
      data instanceof ArrayBuffer ||
      ArrayBuffer.isView(data)
    ) {
      handlers.onAudio(
        toArrayBuffer(data as Buffer | ArrayBuffer | ArrayBufferView | Buffer[]),
      );
      return;
    }
    dispatchIncoming(typeof data === "string" ? data : String(data), handlers);
  };
  const onNodeClose = (..._args: unknown[]) => {
    handlers.onClose?.();
  };
  const onNodeError = (...args: unknown[]) => {
    const err = args[0];
    handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
  };

  if (typeof socket.addEventListener === "function") {
    socket.addEventListener("message", onBrowserMessage);
    socket.addEventListener("close", onBrowserClose);
    socket.addEventListener("error", onBrowserError);
    return () => {
      socket.removeEventListener?.("message", onBrowserMessage);
      socket.removeEventListener?.("close", onBrowserClose);
      socket.removeEventListener?.("error", onBrowserError);
    };
  }

  if (typeof socket.on === "function") {
    socket.on("message", onNodeMessage);
    socket.on("close", onNodeClose);
    socket.on("error", onNodeError);
    return () => {
      socket.off?.("message", onNodeMessage);
      socket.off?.("close", onNodeClose);
      socket.off?.("error", onNodeError);
    };
  }

  throw new Error("WebSocket-like object has no event API (addEventListener/on)");
}

export function sendAudio(socket: WebSocketLike, chunk: ArrayBuffer): void {
  if (socket.readyState !== WS_OPEN) return;
  // Prefer Buffer on Node for reliable binary frames with `ws`
  if (typeof Buffer !== "undefined") {
    socket.send(Buffer.from(new Uint8Array(chunk)));
    return;
  }
  socket.send(chunk);
}

export function sendEvent(socket: WebSocketLike, event: VoiceLineEvent): void {
  if (socket.readyState !== WS_OPEN) return;
  socket.send(JSON.stringify(event));
}

function dispatchIncoming(data: unknown, handlers: SocketHandlers): void {
  if (data instanceof ArrayBuffer) {
    handlers.onAudio(data);
    return;
  }
  if (ArrayBuffer.isView(data)) {
    handlers.onAudio(copyToArrayBuffer(data));
    return;
  }
  if (typeof data === "string") {
    try {
      handlers.onEvent(JSON.parse(data) as VoiceLineEvent);
    } catch {
      /* ignore malformed JSON */
    }
  }
}

export function copyToArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

export function toArrayBuffer(
  data: Buffer | ArrayBuffer | ArrayBufferView | Buffer[],
): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (Array.isArray(data)) {
    return copyToArrayBuffer(Buffer.concat(data));
  }
  if (ArrayBuffer.isView(data)) {
    return copyToArrayBuffer(data);
  }
  // Buffer
  return copyToArrayBuffer(data);
}
