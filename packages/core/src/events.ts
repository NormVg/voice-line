import type { SessionState } from "./types.js";

/**
 * Event protocol between client and server.
 * Audio travels on a separate binary channel — never mixed with these JSON events.
 */

// ── Server → Client ──────────────────────────────────────────────────────────

export interface SessionReadyEvent {
  type: "session:ready";
  sessionId: string;
}

export interface StateChangeEvent {
  type: "state:change";
  state: SessionState;
}

export interface TranscriptPartialEvent {
  type: "transcript:partial";
  text: string;
}

export interface TranscriptFinalEvent {
  type: "transcript:final";
  text: string;
  messageId: string;
}

export interface BotTextDeltaEvent {
  type: "bot:text:delta";
  delta: string;
  messageId: string;
}

export interface BotTextDoneEvent {
  type: "bot:text:done";
  text: string;
  messageId: string;
  partial: boolean;
}

export interface AudioFlushEvent {
  type: "audio:flush";
}

/** Server → Client: A fatal or recoverable error occurred. */
export interface ErrorEvent {
  type: "error";
  error: {
    code: string;
    message: string;
  };
}

export type ServerToClientEvent =
  | SessionReadyEvent
  | StateChangeEvent
  | TranscriptPartialEvent
  | TranscriptFinalEvent
  | BotTextDeltaEvent
  | BotTextDoneEvent
  | AudioFlushEvent
  | ErrorEvent;

// ── Client → Server ──────────────────────────────────────────────────────────

export interface ClientReadyEvent {
  type: "client:ready";
  capabilities: {
    audio: boolean;
    sampleRate?: number;
  };
}

export interface TextSendEvent {
  type: "text:send";
  text: string;
}

export interface MicToggleEvent {
  type: "mic:toggle";
  enabled: boolean;
}

export type ClientToServerEvent = ClientReadyEvent | TextSendEvent | MicToggleEvent;

/** Any protocol event on the event channel. */
export type VoiceLineEvent = ServerToClientEvent | ClientToServerEvent;

export function isServerEvent(event: VoiceLineEvent): event is ServerToClientEvent {
  return (
    event.type === "session:ready" ||
    event.type === "state:change" ||
    event.type === "transcript:partial" ||
    event.type === "transcript:final" ||
    event.type === "bot:text:delta" ||
    event.type === "bot:text:done" ||
    event.type === "audio:flush" ||
    event.type === "error"
  );
}

export function isClientEvent(event: VoiceLineEvent): event is ClientToServerEvent {
  return event.type === "client:ready" || event.type === "text:send" || event.type === "mic:toggle";
}
