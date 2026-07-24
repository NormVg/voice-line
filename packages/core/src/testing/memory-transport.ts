import type { VoiceLineEvent } from "../events.js";
import type { Transport } from "../interfaces/transport.js";
import type { TransportState, Unsubscribe } from "../types.js";

/**
 * In-memory transport pair for tests.
 * `createMemoryTransportPair()` returns linked server/client transports.
 */
export class MemoryTransport implements Transport {
  private stateValue: TransportState = "idle";
  private audioHandlers = new Set<(chunk: ArrayBuffer) => void>();
  private eventHandlers = new Set<(event: VoiceLineEvent) => void>();
  private peer: MemoryTransport | null = null;

  get state(): TransportState {
    return this.stateValue;
  }

  /** Link this transport to its peer (internal). */
  link(peer: MemoryTransport): void {
    this.peer = peer;
  }

  async connect(_sessionId: string): Promise<void> {
    this.stateValue = "connected";
  }

  async disconnect(): Promise<void> {
    this.stateValue = "disconnected";
    this.audioHandlers.clear();
    this.eventHandlers.clear();
  }

  sendAudio(chunk: ArrayBuffer): void {
    this.peer?.receiveAudio(chunk);
  }

  onAudio(handler: (chunk: ArrayBuffer) => void): Unsubscribe {
    this.audioHandlers.add(handler);
    return () => {
      this.audioHandlers.delete(handler);
    };
  }

  sendEvent(event: VoiceLineEvent): void {
    this.peer?.receiveEvent(event);
  }

  onEvent(handler: (event: VoiceLineEvent) => void): Unsubscribe {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  private receiveAudio(chunk: ArrayBuffer): void {
    for (const h of this.audioHandlers) h(chunk);
  }

  private receiveEvent(event: VoiceLineEvent): void {
    for (const h of this.eventHandlers) h(event);
  }
}

export function createMemoryTransportPair(): {
  server: MemoryTransport;
  client: MemoryTransport;
} {
  const server = new MemoryTransport();
  const client = new MemoryTransport();
  server.link(client);
  client.link(server);
  return { server, client };
}
