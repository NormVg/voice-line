import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_BUFFERED_BYTES, sendAudio, WS_OPEN } from "../src/socket.js";
import type { WebSocketLike } from "../src/socket.js";

function mockSocket(bufferedAmount: number): WebSocketLike & { sent: ArrayBuffer[] } {
  const sent: ArrayBuffer[] = [];
  return {
    readyState: WS_OPEN,
    bufferedAmount,
    sent,
    send(data: string | ArrayBuffer | Uint8Array | Buffer) {
      if (typeof data === "string") return;
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
        sent.push(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        return;
      }
      if (data instanceof ArrayBuffer) sent.push(data);
      else if (ArrayBuffer.isView(data)) {
        sent.push(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      }
    },
    close() {},
  };
}

describe("WS audio backpressure", () => {
  it("sends when buffer is under the limit", () => {
    const socket = mockSocket(0);
    const chunk = new ArrayBuffer(100);
    expect(sendAudio(socket, chunk, { maxBufferedBytes: 1024 })).toBe(true);
    expect(socket.sent.length).toBe(1);
  });

  it("drops audio when buffer exceeds the limit", () => {
    const socket = mockSocket(DEFAULT_MAX_BUFFERED_BYTES + 1);
    const chunk = new ArrayBuffer(100);
    expect(sendAudio(socket, chunk)).toBe(false);
    expect(socket.sent.length).toBe(0);
  });

  it("disables backpressure when maxBufferedBytes is 0", () => {
    const socket = mockSocket(10_000_000);
    const chunk = new ArrayBuffer(100);
    expect(sendAudio(socket, chunk, { maxBufferedBytes: 0 })).toBe(true);
    expect(socket.sent.length).toBe(1);
  });
});
