import type {
  ClientState,
  Message,
  SessionState,
  Transport,
  Unsubscribe,
  VoiceLineEvent,
} from "@voice-line/core";
import { createId } from "@voice-line/core";
import { EventDispatcher } from "./events.js";
import { Microphone } from "./mic.js";
import { Speaker } from "./speaker.js";

export interface VoiceLineClientOptions {
  /** Connected transport (already created for this session). */
  transport: Transport;
  sampleRate?: number;
  chunkDurationMs?: number;
  autoMic?: boolean;
  /** Whether the user can interrupt the bot while it's speaking. Default false (half-duplex) to prevent echo loops. */
  bargeIn?: boolean;
}

export interface VoiceLineErrorPayload {
  code: string;
  message: string;
}

export interface VoiceLineClientEvents {
  state: (state: ClientState) => void;
  message: (message: Message) => void;
  messages: (messages: Message[]) => void;
  partialTranscript: (text: string) => void;
  error: (error: Error & { code?: string }) => void;
}

type EventKey = keyof VoiceLineClientEvents;
type AnyHandler = (...args: unknown[]) => void;

/**
 * Framework-agnostic browser client.
 * Vue/React packages wrap this with reactivity.
 */
export class VoiceLineClient {
  private readonly transport: Transport;
  private readonly sampleRate: number;
  private readonly autoMic: boolean;
  private readonly bargeIn: boolean;
  private readonly dispatcher = new EventDispatcher();
  private readonly speaker: Speaker;
  private mic: Microphone | null = null;

  private state: ClientState = "idle";
  private messages: Message[] = [];
  private sessionId: string | null = null;
  private unsubs: Unsubscribe[] = [];
  private listeners = new Map<EventKey, Set<AnyHandler>>();
  private currentAssistantId: string | null = null;
  private currentAssistantText = "";
  private connected = false;

  constructor(options: VoiceLineClientOptions) {
    this.transport = options.transport;
    this.sampleRate = options.sampleRate ?? 16_000;
    this.autoMic = options.autoMic ?? true;
    this.bargeIn = options.bargeIn ?? false;
    this.speaker = new Speaker(this.sampleRate);

    this.mic = new Microphone({
      sampleRate: this.sampleRate,
      chunkDurationMs: options.chunkDurationMs ?? 100,
      onChunk: (pcm) => {
        if (!this.connected) return;
        if (!this.bargeIn && this.isBotSpeaking) return;
        this.transport.sendAudio(pcm);
      },
      onError: (err) => this.emit("error", err),
    });
  }

  get currentState(): ClientState {
    return this.state;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isBotSpeaking(): boolean {
    return this.state === "speaking" || this.speaker.isPlaying;
  }

  get history(): readonly Message[] {
    return this.messages;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  on<K extends EventKey>(event: K, handler: VoiceLineClientEvents[K]): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as AnyHandler);
    return () => {
      set?.delete(handler as AnyHandler);
    };
  }

  async connect(sessionId?: string): Promise<void> {
    if (this.connected) return;
    this.setState("connecting");

    const id = sessionId ?? createId("ses");
    await this.transport.connect(id);
    this.sessionId = id;
    this.connected = true;

    this.unsubs.push(
      this.transport.onEvent((event) => {
        console.log(`[VoiceLineClient] Received server event:`, event.type);
        this.dispatcher.dispatch(event);
        this.handleServerEvent(event);
      }),
    );

    this.unsubs.push(
      this.transport.onAudio((chunk) => {
        void this.speaker.enqueue(chunk, this.sampleRate);
      }),
    );

    this.transport.sendEvent({
      type: "client:ready",
      capabilities: { audio: true, sampleRate: this.sampleRate },
    });

    if (this.autoMic) {
      await this.mic?.start();
    }

    console.log(`[VoiceLineClient] Connected, setting state to listening`);
    this.setState("listening");
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    await this.mic?.stop();
    await this.speaker.destroy();
    await this.transport.disconnect();
    this.setState("idle");
  }

  async toggleMic(enabled?: boolean): Promise<void> {
    if (!this.mic) return;
    const next = enabled ?? !this.mic.isEnabled;
    if (next && !this.mic.isEnabled) {
      await this.mic.start();
    }
    this.mic.setEnabled(next);
    this.transport.sendEvent({ type: "mic:toggle", enabled: next });
  }

  /** Send a typed message through the same brain pipeline. */
  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.connected) return;
    this.transport.sendEvent({ type: "text:send", text: trimmed });
  }

  private setMessages(messages: Message[]) {
    this.messages = messages;
    this.emit("messages", messages);
  }

  private handleServerEvent(event: VoiceLineEvent): void {
    switch (event.type) {
      case "session:ready":
        this.sessionId = event.sessionId;
        break;

      case "state:change":
        this.setState(mapSessionState(event.state));
        break;

      case "transcript:partial":
        this.emit("partialTranscript", event.text);
        break;

      case "transcript:final": {
        if (this.messages.some((m) => m.id === event.messageId)) break;
        const msg: Message = {
          id: event.messageId,
          role: "user",
          content: event.text,
          timestamp: Date.now(),
          partial: false,
        };
        this.setMessages([...this.messages, msg]);
        this.emit("message", msg);
        break;
      }

      case "bot:text:delta": {
        const idx = this.messages.findIndex((m) => m.id === event.messageId);
        if (idx === -1) {
          const msg: Message = {
            id: event.messageId,
            role: "assistant",
            content: event.delta,
            timestamp: Date.now(),
            partial: true,
          };
          this.setMessages([...this.messages, msg]);
        } else {
          const updated = [...this.messages];
          const oldMsg = updated[idx];
          if (oldMsg) {
            updated[idx] = { ...oldMsg, content: oldMsg.content + event.delta };
          }
          this.setMessages(updated);
        }
        break;
      }

      case "bot:text:done": {
        const idx = this.messages.findIndex((m) => m.id === event.messageId);
        if (idx === -1) {
          const msg: Message = {
            id: event.messageId,
            role: "assistant",
            content: event.text,
            timestamp: Date.now(),
            partial: event.partial,
          };
          this.setMessages([...this.messages, msg]);
          this.emit("message", msg);
        } else {
          const updated = [...this.messages];
          const oldMsg = updated[idx];
          if (oldMsg) {
            updated[idx] = { ...oldMsg, content: event.text, partial: event.partial };
          }
          this.setMessages(updated);
        }
        break;
      }

      case "audio:flush":
        this.speaker.flush();
        break;

      case "error": {
        const err = new Error(event.error.message) as Error & { code?: string };
        err.code = event.error.code;
        this.emit("error", err);
        break;
      }

      default:
        break;
    }
  }

  private setState(state: ClientState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit("state", state);
  }

  private emit<K extends EventKey>(event: K, ...args: Parameters<VoiceLineClientEvents[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      handler(...args);
    }
  }
}

function mapSessionState(state: SessionState): ClientState {
  switch (state) {
    case "idle":
    case "closed":
      return "idle";
    case "connected":
      return "connecting";
    case "listening":
    case "receiving":
    case "processing":
    case "speaking":
      return state;
    default:
      return "idle";
  }
}
