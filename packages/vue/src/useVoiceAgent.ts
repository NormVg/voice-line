import { VoiceLineClient } from "@voice-line/client";
import type { ClientState, Message, Transport } from "@voice-line/core";
import { computed, onUnmounted, ref, shallowRef, type ComputedRef, type Ref } from "vue";

export interface UseVoiceAgentOptions {
  /** Pre-built session or a factory to fetch a token and create one lazily. */
  session:
    | { transport: Transport; sessionId?: string }
    | (() => Promise<{ transport: Transport; sessionId: string }>);
  sampleRate?: number;
  autoMic?: boolean;
}

export interface UseVoiceAgentReturn {
  state: Ref<ClientState>;
  messages: Ref<Message[]>;
  error: Ref<(Error & { code?: string }) | null>;
  isConnected: ComputedRef<boolean>;
  isBotSpeaking: ComputedRef<boolean>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMic: (enabled?: boolean) => Promise<void>;
  sendText: (text: string) => void;
  clearError: () => void;
  client: Ref<VoiceLineClient | null>;
}

/**
 * Vue 3 composable wrapping VoiceLineClient.
 * Reactivity only — no domain logic here.
 */
export function useVoiceAgent(options: UseVoiceAgentOptions): UseVoiceAgentReturn {
  const state = ref<ClientState>("idle");
  const messages = ref<Message[]>([]);
  const error = ref<(Error & { code?: string }) | null>(null);
  const client = shallowRef<VoiceLineClient | null>(null);
  let activeSessionId: string | undefined;

  const isConnected = computed(() => state.value !== "idle" && state.value !== "connecting");
  const isBotSpeaking = computed(() => state.value === "speaking");

  async function connect(): Promise<void> {
    error.value = null;
    try {
      if (!client.value) {
        state.value = "connecting";
        const s = typeof options.session === "function" ? await options.session() : options.session;

        activeSessionId = s.sessionId;

        const clientOptions: ConstructorParameters<typeof VoiceLineClient>[0] = {
          transport: s.transport,
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
        c.on("error", (err) => {
          error.value = err;
        });
        client.value = c;
      }

      await client.value.connect(activeSessionId);
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      state.value = "idle";
    }
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

  function clearError() {
    error.value = null;
  }

  onUnmounted(() => {
    void disconnect();
  });

  return {
    state,
    messages,
    error,
    isConnected,
    isBotSpeaking,
    connect,
    disconnect,
    toggleMic,
    sendText,
    clearError,
    client,
  };
}
