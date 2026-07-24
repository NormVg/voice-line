import { VoiceLineClient } from "@voice-line/client";
import type { ClientState, Message, Transport } from "@voice-line/core";
import { computed, onUnmounted, ref, shallowRef, type ComputedRef, type Ref } from "vue";

export interface UseVoiceAgentOptions {
  /** Pre-built transport (Ably, WS, etc.). */
  transport: Transport;
  /** Optional session id; otherwise generated on connect. */
  sessionId?: string;
  sampleRate?: number;
  autoMic?: boolean;
}

export interface UseVoiceAgentReturn {
  state: Ref<ClientState>;
  messages: Ref<Message[]>;
  isConnected: ComputedRef<boolean>;
  isBotSpeaking: ComputedRef<boolean>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMic: (enabled?: boolean) => Promise<void>;
  sendText: (text: string) => void;
  client: Ref<VoiceLineClient | null>;
}

/**
 * Vue 3 composable wrapping VoiceLineClient.
 * Reactivity only — no domain logic here.
 */
export function useVoiceAgent(options: UseVoiceAgentOptions): UseVoiceAgentReturn {
  const state = ref<ClientState>("idle");
  const messages = ref<Message[]>([]);
  const client = shallowRef<VoiceLineClient | null>(null);

  const isConnected = computed(() => state.value !== "idle" && state.value !== "connecting");
  const isBotSpeaking = computed(() => state.value === "speaking");

  function ensureClient(): VoiceLineClient {
    if (client.value) return client.value;
    const clientOptions: ConstructorParameters<typeof VoiceLineClient>[0] = {
      transport: options.transport,
    };
    if (options.sampleRate !== undefined) clientOptions.sampleRate = options.sampleRate;
    if (options.autoMic !== undefined) clientOptions.autoMic = options.autoMic;
    const c = new VoiceLineClient(clientOptions);
    c.on("state", (s) => {
      state.value = s;
    });
    c.on("messages", (msgs) => {
      messages.value = msgs;
    });
    client.value = c;
    return c;
  }

  async function connect(): Promise<void> {
    const c = ensureClient();
    await c.connect(options.sessionId);
  }

  async function disconnect(): Promise<void> {
    await client.value?.disconnect();
    client.value = null;
    state.value = "idle";
  }

  async function toggleMic(enabled?: boolean): Promise<void> {
    await client.value?.toggleMic(enabled);
  }

  function sendText(text: string): void {
    client.value?.sendText(text);
  }

  onUnmounted(() => {
    void disconnect();
  });

  return {
    state,
    messages,
    isConnected,
    isBotSpeaking,
    connect,
    disconnect,
    toggleMic,
    sendText,
    client,
  };
}
