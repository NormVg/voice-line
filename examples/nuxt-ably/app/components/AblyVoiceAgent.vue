<script setup lang="ts">
import { VoiceLineClient } from "@voice-line/client";
import { AblyTransport } from "@voice-line/transport-ably";
import type { ClientState, Message } from "@voice-line/core";
import { computed, ref, onUnmounted, shallowRef } from "vue";
import Ably from "ably";

const error = ref<string | null>(null);
const partial = ref("");
const textInput = ref("");
const connecting = ref(false);

const state = ref<ClientState>("idle");
const messages = ref<Message[]>([]);
const client = shallowRef<VoiceLineClient | null>(null);

const isConnected = computed(() => state.value !== "idle" && state.value !== "connecting");
const isBotSpeaking = computed(() => state.value === "speaking");

const statusLabel = computed(() => {
  if (connecting.value) return "connecting…";
  return state.value;
});

const statusClass = computed(() => {
  switch (state.value) {
    case "listening": return "ok";
    case "receiving": case "processing": case "speaking": return "active";
    case "connecting": return "warn";
    default: return "idle";
  }
});

function bindClientEvents(c: VoiceLineClient) {
  c.on("state", (s) => { state.value = s; });
  c.on("messages", (msgs) => { messages.value = msgs; });
  c.on("partialTranscript", (text) => { partial.value = text; });
  c.on("error", (err) => { error.value = err.message; });
  c.on("message", () => { partial.value = ""; });
}

async function onConnect() {
  error.value = null;
  connecting.value = true;
  try {
    // 1. Ask the server to create a session and give us a token request
    const response = await fetch("/api/session", { method: "POST" });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server error: ${errText}`);
    }
    const { sessionId, tokenRequest } = await response.json();

    // 2. Create the Ably transport using the token request
    const transport = new AblyTransport({
      role: "client",
      authCallback: (_, callback) => {
        callback(null, tokenRequest);
      },
      channelName: () => `voice-line:${sessionId}`,
      Realtime: Ably.Realtime,
    });

    // 3. Initialize the VoiceLineClient
    const c = new VoiceLineClient({
      transport,
      sampleRate: 16_000,
      autoMic: true,
    });
    
    bindClientEvents(c);
    client.value = c;

    // 4. Connect using the sessionId provided by the server
    await c.connect(sessionId);
    
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    connecting.value = false;
  }
}

async function onDisconnect() {
  partial.value = "";
  if (client.value) {
    await client.value.disconnect();
    client.value = null;
  }
  state.value = "idle";
}

function onSendText() {
  const t = textInput.value.trim();
  if (!t) return;
  client.value?.sendText(t);
  textInput.value = "";
  partial.value = "";
}

async function onToggleMic() {
  try { await client.value?.toggleMic(); }
  catch (err) { error.value = err instanceof Error ? err.message : String(err); }
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

    <p v-if="error" class="error">{{ error }}</p>

    <div class="controls">
      <button v-if="!isConnected" class="btn primary" :disabled="connecting" type="button" @click="onConnect">
        {{ connecting ? "Connecting…" : "Connect" }}
      </button>
      <template v-else>
        <button class="btn" type="button" @click="onToggleMic">Mic</button>
        <button class="btn danger" type="button" @click="onDisconnect">Disconnect</button>
      </template>
      <span v-if="isBotSpeaking" class="pill">bot speaking</span>
    </div>

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
        Connect, then speak or type. Audio and events go over Ably!
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
