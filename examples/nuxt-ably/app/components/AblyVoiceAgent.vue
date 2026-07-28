<script setup lang="ts">
import { useVoiceAgent } from "@voice-line/vue";
import { createAblyClientSession } from "@voice-line/transport-ably";
import { computed, ref, onUnmounted } from "vue";
import Ably from "ably";

const partial = ref("");
const textInput = ref("");

const vadConfidence = ref(0.4);
const vadSilenceMs = ref(800);

const {
  state,
  messages,
  error,
  isConnected,
  isBotSpeaking,
  connect: baseConnect,
  disconnect,
  toggleMic,
  sendText,
  client,
} = useVoiceAgent({
  session: createAblyClientSession("/api/session", Ably.Realtime, {
    vad: {
      confidence: vadConfidence.value,
      silenceMs: vadSilenceMs.value,
    },
  }),
  sampleRate: 16_000,
  autoMic: true,
});

const connecting = computed(() => state.value === "connecting");

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

async function onConnect() {
  await baseConnect();
  if (client.value) {
    client.value.on("partialTranscript", (text) => {
      partial.value = text;
    });
    client.value.on("message", () => {
      partial.value = "";
    });
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
  await toggleMic();
}

onUnmounted(() => {
  void onDisconnect();
});
</script>

<template>
  <section class="voice-panel">
    <header class="header">
      <div>
        <h1>voice-line (Ably)</h1>
        <p class="sub">Nuxt · Ably Transport · Sarvam · Ollama Cloud</p>
      </div>
      <div class="status" :class="statusClass">
        <span class="dot" />
        {{ statusLabel }}
      </div>
    </header>

    <p v-if="error" class="error">{{ error.message }}</p>

    <div v-if="!isConnected" class="settings">
      <div class="setting-group">
        <label>
          <span>VAD Confidence ({{ vadConfidence }})</span>
          <input type="range" v-model.number="vadConfidence" min="0.1" max="0.9" step="0.05" :disabled="connecting" />
          <small>Lower = picks up quieter speech, Higher = requires louder speech</small>
        </label>
      </div>
      <div class="setting-group">
        <label>
          <span>VAD Silence Timeout ({{ vadSilenceMs }}ms)</span>
          <input type="range" v-model.number="vadSilenceMs" min="200" max="2000" step="100" :disabled="connecting" />
          <small>How long to wait after you stop speaking before replying</small>
        </label>
      </div>
    </div>

    <div class="controls">
      <button v-if="!isConnected" class="btn primary" :disabled="connecting" type="button" @click="onConnect">
        {{ connecting ? "Connecting…" : "Connect" }}
      </button>
      <template v-else>
        <button class="btn" type="button" @click="onToggleMic">Mic</button>
        <button class="btn danger" type="button" @click="onDisconnect">Disconnect</button>
      </template>
      <span v-if="isBotSpeaking" class="pill">bot speaking · barge-in ready</span>
    </div>
    <p v-if="isConnected && isBotSpeaking" class="hint">
      Talk over the bot or type below to interrupt.
    </p>

    <div class="messages" aria-live="polite">
      <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
        <span class="role">{{ m.role }}</span>
        <p>{{ m.content }}</p>
        <span v-if="m.partial" class="partial-tag">interrupted</span>
      </div>
      <div v-if="partial" class="msg user partial">
        <span class="role">user</span>
        <p>{{ partial }}…</p>
      </div>
      <p v-if="messages.length === 0 && !partial" class="empty">
        Connect, then speak or type. Audio and events go over Ably. Interrupt
        anytime while the bot is speaking.
      </p>
    </div>

    <form class="composer" @submit.prevent="onSendText">
      <input v-model="textInput" type="text" placeholder="Type instead of speaking…" :disabled="!isConnected" autocomplete="off" />
      <button class="btn primary" type="submit" :disabled="!isConnected">Send</button>
    </form>
  </section>
</template>

<style scoped>
/* Basic styles inherited from the Nuxt app */
.voice-panel {
  max-width: 48rem;
  margin: 2rem auto;
  border-radius: 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  height: calc(100vh - 4rem);
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  overflow: hidden;
}

.header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255,255,255,0.02);
}

.header h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}

.sub {
  margin: 0.25rem 0 0 0;
  font-size: 0.85rem;
  color: var(--muted);
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  background: var(--bg-deep);
  color: var(--muted);
  border: 1px solid var(--border);
}

.status .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status.ok { color: #34d399; border-color: rgba(52, 211, 153, 0.2); background: rgba(52, 211, 153, 0.05); }
.status.active { color: #60a5fa; border-color: rgba(96, 165, 250, 0.2); background: rgba(96, 165, 250, 0.05); }
.status.warn { color: #fbbf24; border-color: rgba(251, 191, 36, 0.2); background: rgba(251, 191, 36, 0.05); }

.error {
  margin: 0;
  padding: 1rem 1.5rem;
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  border-bottom: 1px solid rgba(239, 68, 68, 0.2);
  font-size: 0.875rem;
}

.settings {
  padding: 1.5rem 1.5rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border-bottom: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.1);
}

.setting-group label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--text);
}

.setting-group span {
  font-weight: 500;
}

.setting-group small {
  font-size: 0.75rem;
  color: var(--muted);
}

.setting-group input[type="range"] {
  accent-color: #60a5fa;
  cursor: pointer;
}

.controls {
  padding: 1rem 1.5rem;
  display: flex;
  gap: 0.75rem;
  border-bottom: 1px solid var(--border);
  align-items: center;
}

.btn {
  appearance: none;
  background: var(--bg-deep);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn:hover:not(:disabled) { background: var(--border); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn.primary {
  background: var(--text);
  color: var(--bg-deep);
  border-color: transparent;
}
.btn.primary:hover:not(:disabled) { background: #e5e5e5; }
.btn.danger { color: #fca5a5; border-color: rgba(239,68,68,0.3); }
.btn.danger:hover:not(:disabled) { background: rgba(239,68,68,0.1); }

.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--muted);
}

.pill {
  font-size: 0.75rem;
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.1);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  margin-left: auto;
  font-weight: 500;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.msg {
  max-width: 85%;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.msg.user { align-self: flex-end; align-items: flex-end; }
.msg.assistant { align-self: flex-start; }
.msg p { margin: 0; line-height: 1.5; font-size: 0.95rem; }

.role {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  font-weight: 600;
}

.msg.user p {
  background: var(--border);
  padding: 0.75rem 1rem;
  border-radius: 12px 12px 0 12px;
}
.msg.assistant p {
  background: rgba(255,255,255,0.03);
  border: 1px solid var(--border);
  padding: 0.75rem 1rem;
  border-radius: 12px 12px 12px 0;
}
.msg.partial { opacity: 0.7; }
.partial-tag {
  font-size: 0.7rem;
  color: #fbbf24;
  margin-top: 0.25rem;
}

.empty {
  margin: auto;
  color: var(--muted);
  text-align: center;
  max-width: 24rem;
  line-height: 1.5;
  font-size: 0.9rem;
}

.composer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 0.75rem;
  background: rgba(255,255,255,0.02);
}

.composer input {
  flex: 1;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 1rem;
  color: var(--text);
  font-size: 0.95rem;
}
.composer input:focus {
  outline: none;
  border-color: #60a5fa;
}
.composer input:disabled { opacity: 0.5; }
</style>
