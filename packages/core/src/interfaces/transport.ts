import type { VoiceLineEvent } from "../events.js";
import type { TransportState, Unsubscribe } from "../types.js";

/**
 * Moves binary audio and JSON events between client and server.
 * Knows nothing about audio semantics, VAD, or AI.
 */
export interface Transport {
  connect(sessionId: string): Promise<void>;
  disconnect(): Promise<void>;

  sendAudio(chunk: ArrayBuffer): void;
  onAudio(handler: (chunk: ArrayBuffer) => void): Unsubscribe;

  sendEvent(event: VoiceLineEvent): void;
  onEvent(handler: (event: VoiceLineEvent) => void): Unsubscribe;

  readonly state: TransportState;
}

/**
 * Optional return type for a TransportFactory.
 * Allows a transport to pass auth payloads (like tokenRequests) back to the client.
 */
export interface TransportFactoryResult {
  transport: Transport;
  clientPayload?: Record<string, unknown>;
}

/**
 * Factory that creates a Transport for a new session.
 * Server-side: often creates a channel and returns credentials for the client.
 * Client-side: connects with auth tokens from the server.
 */
export type TransportFactory = (
  sessionId: string,
) =>
  | Transport
  | Promise<Transport>
  | TransportFactoryResult
  | Promise<TransportFactoryResult>;
