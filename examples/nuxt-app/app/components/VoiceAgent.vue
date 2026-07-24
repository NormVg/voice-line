<script setup lang="ts">
import { useVoiceAgent } from "@voice-line/vue";
import { WsTransport } from "@voice-line/transport-ws";
import { computed, ref, shallowRef } from "vue";

const props = defineProps<{
  wsUrl: string;
  sampleRate?: number;
}>();

const error = ref<string | null>(null);
const partial = ref("");
const textInput = ref("");
const connecting = ref(false);

const transport = shallowRef(
  new WsTransport({
    url: (sessionId) => {
      const base = props.wsUrl;
      const sep = base.includes("?") ? "&" : "?";
      return `${base}${sep}session=${encodeURIComponent(sessionId)}`;
    },
  }),
);

const {
  state,
  messages,
  isConnected,
  isBotSpeaking,
  connect,
  disconnect,
  toggleMic,
  sendText,
  client,
} = useVoiceAgent({
  transport: transport.value,
  sampleRate: props.sampleRate ?? 16_000,
  autoMic: true,
});

const statusLabel = computed(() => {
  if (connecting.value) return "connecting…";
  return state.value;
});

const statusClass = computed(() => {
  switch (state.value) {
    case "listening":
      return "ok";
    case "receiving":
    case "processing":
    case "speaking":
      return "active";
    case "connecting":
      return "warn";
    default:
      return "idle";
  }
});

function bindClientEvents() {
  client.value?.on("partialTranscript", (text) => {
    partial.value = text;
  });
  client.value?.on("error", (err) => {
    error.value = err.message;
  });
  client.value?.on("message", () => {
    partial.value = "";
  });
}

async function onConnect() {
  error.value = null;
  connecting.value = true;
  try {
    await connect();
    bindClientEvents();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    connecting.value = false;
  }
}

async function onDisconnect() {
  partial.value = "";
  await disconnect();
}

function onSendText() {
  const t = textInput.value.trim();
  if (!t) return;
  sendText(t);
  textInput.value = "";
  partial.value = "";
}

async function onToggleMic() {
  try {
    await toggleMic();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <section class="voice-panel">
    <header class="header">
      <div>
        <h1>voice-line</h1>
        <p class="sub">Nuxt · WebSocket · Sarvam · Ollama Cloud</p>
      </div>
      <div class="status" :class="statusClass">
        <span class="dot" />
        {{ statusLabel }}
      </div>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="controls">
      <button
        v-if="!isConnected"
        class="btn primary"
        :disabled="connecting"
        type="button"
        @click="onConnect"
      >
        {{ connecting ? "Connecting…" : "Connect" }}
      </button>
      <template v-else>
        <button class="btn" type="button" @click="onToggleMic">Mic</button>
        <button class="btn danger" type="button" @click="onDisconnect">
          Disconnect
        </button>
      </template>
      <span v-if="isBotSpeaking" class="pill">bot speaking</span>
    </div>

    <div class="messages" aria-live="polite">
      <div
        v-for="m in messages"
        :key="m.id"
        class="msg"
        :class="m.role"
      >
        <span class="role">{{ m.role }}</span>
        <p>{{ m.content }}</p>
        <span v-if="m.partial" class="partial-tag">interrupted</span>
      </div>
      <div v-if="partial" class="msg user partial">
        <span class="role">user</span>
        <p>{{ partial }}…</p>
      </div>
      <p v-if="messages.length === 0 && !partial" class="empty">
        Connect, then speak or type. Audio goes over WebSocket; Sarvam does
        STT/TTS; AI SDK is the brain.
      </p>
    </div>

    <form class="composer" @submit.prevent="onSendText">
      <input
        v-model="textInput"
        type="text"
        placeholder="Type instead of speaking…"
        :disabled="!isConnected"
        autocomplete="off"
      />
      <button class="btn primary" type="submit" :disabled="!isConnected">
        Send
      </button>
    </form>
  </section>
</template>

<style scoped>
.voice-panel {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-height: 100vh;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.sub {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  font-size: 0.8rem;
  text-transform: lowercase;
  color: var(--muted);
}

.status .dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--muted);
}

.status.ok .dot {
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
}
.status.ok {
  color: var(--accent);
}

.status.active .dot {
  background: var(--bot);
  animation: pulse 1s ease-in-out infinite;
}
.status.active {
  color: var(--bot);
}

.status.warn .dot {
  background: var(--warn);
}

@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}

.error {
  margin: 0;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  background: #7f1d1d44;
  border: 1px solid var(--danger);
  color: #fecaca;
  font-size: 0.9rem;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.btn {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  border-radius: 0.65rem;
  padding: 0.55rem 1rem;
}

.btn:hover:not(:disabled) {
  border-color: #3a455c;
}

.btn.primary {
  background: linear-gradient(180deg, #34d399, #10b981);
  border-color: transparent;
  color: #042f1a;
  font-weight: 600;
}

.btn.danger {
  border-color: #7f1d1d;
  color: #fecaca;
}

.pill {
  font-size: 0.75rem;
  color: var(--bot);
  border: 1px solid #5b4b8a;
  border-radius: 999px;
  padding: 0.25rem 0.6rem;
}

.messages {
  flex: 1;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 1rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 320px;
  max-height: 55vh;
  overflow: auto;
}

.msg {
  max-width: 90%;
  padding: 0.65rem 0.85rem;
  border-radius: 0.85rem;
  border: 1px solid var(--border);
}

.msg.user {
  align-self: flex-end;
  background: #1e3a5f55;
  border-color: #2563eb55;
}

.msg.assistant {
  align-self: flex-start;
  background: #2e106555;
  border-color: #7c3aed55;
}

.msg.partial {
  opacity: 0.75;
}

.msg .role {
  display: block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-bottom: 0.2rem;
}

.msg p {
  margin: 0;
  line-height: 1.45;
  white-space: pre-wrap;
}

.partial-tag {
  display: inline-block;
  margin-top: 0.35rem;
  font-size: 0.7rem;
  color: var(--warn);
}

.empty {
  margin: auto;
  color: var(--muted);
  text-align: center;
  max-width: 28rem;
  line-height: 1.5;
  font-size: 0.95rem;
}

.composer {
  display: flex;
  gap: 0.5rem;
}

.composer input {
  flex: 1;
  border-radius: 0.65rem;
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 0.7rem 0.9rem;
  outline: none;
}

.composer input:focus {
  border-color: #4b5568;
}
</style>
