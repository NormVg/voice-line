<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useVoiceAgent } from '@voice-line/vue';
import { ws } from '@voice-line/transport-ws';
import {
  PhMicrophoneStage,
  PhStopCircle,
  PhPlugsConnected,
  PhCircleNotch,
  PhLightning,
  PhInfo,
  PhPaperPlaneTilt,
} from '@phosphor-icons/vue';

const host = ref('');
onMounted(() => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  host.value = `${protocol}//${window.location.host}/_ws`;
});

const {
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
} = useVoiceAgent({
  session: async () => {
    const transportFactory = ws({
      url: host.value,
      maxBufferedBytes: 256 * 1024,
    });
    const sessionId = Math.random().toString(36).substring(7);
    return {
      transport: transportFactory(sessionId),
      sessionId,
    };
  },
  sampleRate: 16000,
  autoMic: true,
});

const partial = ref('');
const textInput = ref('');
const connecting = ref(false);
const micActive = ref(true);
const transcriptEl = ref<HTMLElement | null>(null);

watch(
  () => client.value,
  (c) => {
    if (!c) return;
    c.on('partialTranscript', (text) => {
      partial.value = text;
    });
    c.on('message', () => {
      partial.value = '';
    });
  },
);

watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    if (transcriptEl.value) {
      transcriptEl.value.scrollTop = transcriptEl.value.scrollHeight;
    }
  },
);

const connectSession = async () => {
  clearError();
  connecting.value = true;
  try {
    await connect();
    micActive.value = true;
  } finally {
    connecting.value = false;
  }
};

const endSession = async () => {
  partial.value = '';
  await disconnect();
};

const handleToggleMic = () => {
  micActive.value = !micActive.value;
  void toggleMic(micActive.value);
};

const onSendText = () => {
  const t = textInput.value.trim();
  if (!t || !isConnected.value) return;
  // Text turns use the same brain path and barge-in as voice.
  sendText(t);
  textInput.value = '';
  partial.value = '';
};

const stateDisplay = computed(() => {
  if (connecting.value) return 'CONNECTING';
  if (!isConnected.value) return 'OFFLINE';
  switch (state.value) {
    case 'idle':
      return 'STANDBY';
    case 'listening':
      return 'LISTENING';
    case 'receiving':
      return 'RECEIVING_AUDIO';
    case 'processing':
      return 'PROCESSING_LLM';
    case 'speaking':
      return isBotSpeaking.value ? 'BOT_SPEAKING' : 'SYNTHESIZING_TTS';
    default:
      return state.value.toUpperCase();
  }
});

const tip = computed(() => {
  if (!isConnected.value) return 'Connect, allow the mic, then speak.';
  if (isBotSpeaking.value) return 'Talk over the bot to barge-in — playback stops immediately.';
  if (state.value === 'listening') return 'Listening. Speak or type below.';
  if (state.value === 'processing') return 'Thinking… you can still interrupt when it starts talking.';
  return '';
});
</script>

<template>
  <div class="min-h-[100dvh] flex flex-col relative font-sans selection:bg-white selection:text-zinc-950">
    <!-- Header -->
    <header class="h-16 flex items-center justify-between px-6 border-b border-zinc-800">
      <div class="flex items-center gap-3">
        <div class="w-2 h-2 bg-white rounded-full"></div>
        <span class="font-mono text-sm tracking-tight text-white uppercase">voice-line</span>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2">
          <div
            class="w-1.5 h-1.5 rounded-full"
            :class="isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-zinc-600'"
          ></div>
          <span class="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            {{ isConnected ? 'Socket Live' : 'Disconnected' }}
          </span>
        </div>
      </div>
    </header>

    <!-- Main Workspace -->
    <main class="flex-1 flex flex-col md:flex-row relative">
      <!-- Left Panel -->
      <section class="flex-1 p-8 md:p-12 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col justify-between">
        <div>
          <h1 class="text-4xl md:text-6xl tracking-tighter leading-tight font-medium max-w-lg mb-6">
            Real-time voice, zero infrastructure.
          </h1>
          <p class="text-zinc-400 max-w-[45ch] leading-relaxed text-lg">
            A production-ready voice layer for your AI agents.
            Powered by Sarvam AI, wired with raw WebSockets, and piped into the Vercel AI SDK.
          </p>
        </div>

        <div class="mt-12 space-y-3">
          <div class="flex items-start gap-4 p-4 border border-zinc-800 bg-zinc-900/50">
            <PhInfo class="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
            <div class="space-y-1">
              <h3 class="font-mono text-xs uppercase tracking-wider text-zinc-300">Pipeline</h3>
              <p class="text-sm text-zinc-500 leading-relaxed text-pretty">
                Mic → energy VAD → Sarvam STT → LLM stream → sentence chunker → Sarvam TTS → speaker.
                Barge-in flushes playback and aborts this turn only (safe with shared providers).
              </p>
            </div>
          </div>
          <div class="flex items-start gap-4 p-4 border border-zinc-800 bg-zinc-900/50">
            <PhInfo class="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
            <div class="space-y-1">
              <h3 class="font-mono text-xs uppercase tracking-wider text-zinc-300">Try barge-in</h3>
              <p class="text-sm text-zinc-500 leading-relaxed text-pretty">
                Headphones work best. While the bot speaks, talk over it or type a new message —
                audio should stop and the new turn starts.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Right Panel -->
      <section class="flex-1 flex flex-col bg-zinc-950 min-h-[500px]">
        <!-- Status Bar -->
        <div class="flex items-center justify-between px-6 py-3 border-b border-zinc-800 bg-zinc-900/30">
          <div class="flex items-center gap-2">
            <PhLightning
              v-if="state === 'processing' || state === 'speaking' || isBotSpeaking"
              class="w-4 h-4 text-amber-400"
              weight="fill"
            />
            <PhCircleNotch
              v-else-if="state === 'receiving'"
              class="w-4 h-4 text-emerald-400 animate-spin"
            />
            <div
              v-else
              class="w-2 h-2 rounded-full"
              :class="isConnected ? 'bg-zinc-500' : 'bg-zinc-800'"
            ></div>
            <span class="font-mono text-[11px] text-white tracking-widest">{{ stateDisplay }}</span>
            <span
              v-if="isBotSpeaking"
              class="font-mono text-[10px] text-amber-400/90 border border-amber-500/30 px-1.5 py-0.5"
            >
              BARGE-IN READY
            </span>
          </div>

          <div class="font-mono text-[10px] text-zinc-500">MSGS: {{ messages.length }}</div>
        </div>

        <!-- Error -->
        <div
          v-if="error"
          class="mx-6 mt-4 px-3 py-2 border border-red-500/40 bg-red-500/10 text-red-300 text-sm font-mono flex items-center justify-between gap-3"
        >
          <span>{{ error.message }}</span>
          <button type="button" class="text-red-400/80 hover:text-red-200 text-xs uppercase" @click="clearError">
            dismiss
          </button>
        </div>

        <!-- Transcript -->
        <div ref="transcriptEl" class="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col">
          <div
            v-if="messages.length === 0 && !partial"
            class="m-auto text-center flex flex-col items-center gap-4 text-zinc-600"
          >
            <PhMicrophoneStage class="w-8 h-8 opacity-50" />
            <p class="font-mono text-xs uppercase tracking-widest">Awaiting Input</p>
            <p class="text-xs text-zinc-600 max-w-[28ch]">{{ tip }}</p>
          </div>

          <div
            v-for="msg in messages"
            :key="msg.id"
            class="group flex gap-4 max-w-xl"
            :class="msg.role === 'user' ? 'ml-auto text-right flex-row-reverse' : ''"
          >
            <div
              class="shrink-0 w-8 h-8 flex items-center justify-center bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-400"
            >
              {{ msg.role === 'user' ? 'USR' : 'SYS' }}
            </div>
            <div class="space-y-1">
              <div
                class="p-3 text-sm leading-relaxed"
                :class="
                  msg.role === 'user'
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'bg-transparent border border-zinc-800 text-zinc-300'
                "
              >
                {{ msg.content }}
                <span
                  v-if="msg.partial"
                  class="inline-block ml-2 w-1.5 h-1.5 bg-red-500 rounded-full"
                  title="Interrupted"
                ></span>
              </div>
            </div>
          </div>

          <div v-if="partial" class="group flex gap-4 max-w-xl ml-auto text-right flex-row-reverse opacity-70">
            <div
              class="shrink-0 w-8 h-8 flex items-center justify-center bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-400"
            >
              USR
            </div>
            <div class="p-3 text-sm leading-relaxed bg-zinc-100/80 text-zinc-950">
              {{ partial }}…
            </div>
          </div>
        </div>

        <!-- Controls -->
        <div class="p-6 border-t border-zinc-800 bg-zinc-900/30 space-y-3">
          <p v-if="tip && isConnected" class="font-mono text-[10px] text-zinc-500 tracking-wide">
            {{ tip }}
          </p>

          <ClientOnly>
            <div class="flex items-center gap-4">
              <button
                type="button"
                class="flex-1 h-12 flex items-center justify-center gap-2 border transition-all duration-200 active:scale-[0.98]"
                :class="
                  isConnected
                    ? 'border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20'
                    : 'border-white bg-white text-zinc-950 hover:bg-zinc-200'
                "
                :disabled="connecting"
                @click="isConnected ? endSession() : connectSession()"
              >
                <PhCircleNotch v-if="connecting" class="w-5 h-5 animate-spin" />
                <PhStopCircle v-else-if="isConnected" class="w-5 h-5" weight="fill" />
                <PhPlugsConnected v-else class="w-5 h-5" weight="bold" />
                <span class="font-medium tracking-wide uppercase text-sm">
                  {{ connecting ? 'Connecting…' : isConnected ? 'End Session' : 'Initialize Session' }}
                </span>
              </button>

              <button
                type="button"
                :disabled="!isConnected"
                class="w-16 h-12 flex items-center justify-center border transition-all duration-200"
                :class="[
                  !isConnected ? 'border-zinc-800 text-zinc-800 cursor-not-allowed' : '',
                  isConnected && micActive ? 'border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700' : '',
                  isConnected && !micActive ? 'border-red-500/50 bg-red-500/10 text-red-500' : '',
                ]"
                :title="micActive ? 'Mute mic' : 'Unmute mic'"
                @click="handleToggleMic"
              >
                <PhMicrophoneStage class="w-5 h-5" :weight="micActive ? 'regular' : 'fill'" />
              </button>
            </div>

            <form class="flex gap-2" @submit.prevent="onSendText">
              <input
                v-model="textInput"
                type="text"
                placeholder="Type to interrupt or chat…"
                :disabled="!isConnected"
                autocomplete="off"
                class="flex-1 h-11 px-3 bg-zinc-950 border border-zinc-800 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-40"
              />
              <button
                type="submit"
                :disabled="!isConnected || !textInput.trim()"
                class="w-11 h-11 flex items-center justify-center border border-zinc-700 text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send text"
              >
                <PhPaperPlaneTilt class="w-5 h-5" weight="bold" />
              </button>
            </form>

            <template #fallback>
              <div class="flex items-center gap-4 opacity-50 pointer-events-none">
                <div class="flex-1 h-12 flex items-center justify-center gap-2 border border-zinc-800 bg-zinc-900/50">
                  <PhCircleNotch class="w-5 h-5 text-zinc-500 animate-spin" />
                  <span class="font-medium tracking-wide uppercase text-sm text-zinc-500">Loading Client...</span>
                </div>
              </div>
            </template>
          </ClientOnly>
        </div>
      </section>
    </main>
  </div>
</template>
