<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useVoiceAgent } from '@voice-line/vue';
import { ws } from '@voice-line/transport-ws';
import { PhMicrophoneStage, PhStopCircle, PhPlugsConnected, PhCircleNotch, PhLightning, PhInfo } from '@phosphor-icons/vue';

const host = ref('');
onMounted(() => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  host.value = `${protocol}//${window.location.host}/_ws`;
});

const {
  state,
  messages,
  isConnected,
  isBotSpeaking,
  connect,
  disconnect,
  toggleMic,
} = useVoiceAgent({
  session: async () => {
    // ws() returns a factory that takes a sessionId
    const transportFactory = ws({ url: host.value });
    const sessionId = Math.random().toString(36).substring(7);
    return {
      transport: transportFactory(sessionId),
      sessionId,
    };
  }
});

const connectSession = () => {
  connect();
};

const micActive = ref(true);
const handleToggleMic = () => {
  micActive.value = !micActive.value;
  toggleMic(micActive.value);
};

const stateDisplay = computed(() => {
  if (!isConnected.value) return 'OFFLINE';
  switch (state.value) {
    case 'idle': return 'STANDBY';
    case 'listening': return 'LISTENING';
    case 'receiving': return 'RECEIVING_AUDIO';
    case 'processing': return 'PROCESSING_LLM';
    case 'speaking': return 'SYNTHESIZING_TTS';
    default: return state.value.toUpperCase();
  }
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
          <div class="w-1.5 h-1.5 rounded-full" :class="isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-zinc-600'"></div>
          <span class="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            {{ isConnected ? 'Socket Live' : 'Disconnected' }}
          </span>
        </div>
      </div>
    </header>

    <!-- Main Workspace -->
    <main class="flex-1 flex flex-col md:flex-row relative">
      <!-- Left Panel: Hero / Info -->
      <section class="flex-1 p-8 md:p-12 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col justify-between">
        <div>
          <h1 class="text-4xl md:text-6xl tracking-tighter leading-tight font-medium max-w-lg mb-6">
            Real-time voice, zero infrastructure.
          </h1>
          <p class="text-zinc-400 max-w-[45ch] leading-relaxed text-lg">
            A production-ready voice layer for your AI agents. 
            Powered by Sarvam AI, wired with raw WebSockets, and piped directly into the Vercel AI SDK.
          </p>
        </div>

        <div class="mt-12">
          <div class="flex items-start gap-4 p-4 border border-zinc-800 bg-zinc-900/50">
            <PhInfo class="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
            <div class="space-y-1">
              <h3 class="font-mono text-xs uppercase tracking-wider text-zinc-300">Architecture</h3>
              <p class="text-sm text-zinc-500 leading-relaxed text-pretty">
                This demo connects to a local Nitro WebSocket handler. Audio chunks stream through Silero VAD and Sarvam STT directly into gpt-oss:20b-cloud.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Right Panel: Transcript & Controls -->
      <section class="flex-1 flex flex-col bg-zinc-950 min-h-[500px]">
        
        <!-- Status Bar -->
        <div class="flex items-center justify-between px-6 py-3 border-b border-zinc-800 bg-zinc-900/30">
          <div class="flex items-center gap-2">
            <PhLightning v-if="state === 'processing' || state === 'speaking'" class="w-4 h-4 text-amber-400" weight="fill" />
            <PhCircleNotch v-else-if="state === 'receiving'" class="w-4 h-4 text-emerald-400 animate-spin" />
            <div v-else class="w-2 h-2 rounded-full" :class="isConnected ? 'bg-zinc-500' : 'bg-zinc-800'"></div>
            <span class="font-mono text-[11px] text-white tracking-widest">{{ stateDisplay }}</span>
          </div>
          
          <div class="font-mono text-[10px] text-zinc-500">
            MSGS: {{ messages.length }}
          </div>
        </div>

        <!-- Transcript Area -->
        <div class="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col">
          <div v-if="messages.length === 0" class="m-auto text-center flex flex-col items-center gap-4 text-zinc-600">
            <PhMicrophoneStage class="w-8 h-8 opacity-50" />
            <p class="font-mono text-xs uppercase tracking-widest">Awaiting Input</p>
          </div>

          <div v-for="msg in messages" :key="msg.id" class="group flex gap-4 max-w-xl" :class="msg.role === 'user' ? 'ml-auto text-right flex-row-reverse' : ''">
            
            <!-- Avatar -->
            <div class="shrink-0 w-8 h-8 flex items-center justify-center bg-zinc-900 border border-zinc-800 font-mono text-[10px] text-zinc-400">
              {{ msg.role === 'user' ? 'USR' : 'SYS' }}
            </div>

            <!-- Message Body -->
            <div class="space-y-1">
              <div class="p-3 text-sm leading-relaxed" 
                   :class="msg.role === 'user' ? 'bg-zinc-100 text-zinc-950' : 'bg-transparent border border-zinc-800 text-zinc-300'">
                {{ msg.content }}
                <span v-if="msg.partial" class="inline-block ml-2 w-1.5 h-1.5 bg-red-500 rounded-full" title="Interrupted"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Hardware Controls -->
        <div class="p-6 border-t border-zinc-800 bg-zinc-900/30">
          <div class="flex items-center gap-4">
            <!-- Connect/Disconnect Toggle -->
            <button 
              @click="isConnected ? disconnect() : connectSession()"
              class="flex-1 h-12 flex items-center justify-center gap-2 border transition-all duration-200 active:scale-[0.98]"
              :class="isConnected 
                ? 'border-red-500/50 bg-red-500/10 text-red-500 hover:bg-red-500/20' 
                : 'border-white bg-white text-zinc-950 hover:bg-zinc-200'"
            >
              <PhStopCircle v-if="isConnected" class="w-5 h-5" weight="fill" />
              <PhPlugsConnected v-else class="w-5 h-5" weight="bold" />
              <span class="font-medium tracking-wide uppercase text-sm">
                {{ isConnected ? 'End Session' : 'Initialize Session' }}
              </span>
            </button>

            <!-- Mic Toggle -->
            <button 
              @click="handleToggleMic"
              :disabled="!isConnected"
              class="w-16 h-12 flex items-center justify-center border transition-all duration-200"
              :class="[
                !isConnected ? 'border-zinc-800 text-zinc-800 cursor-not-allowed' : '',
                isConnected && micActive ? 'border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700' : '',
                isConnected && !micActive ? 'border-red-500/50 bg-red-500/10 text-red-500' : ''
              ]"
            >
              <PhMicrophoneStage class="w-5 h-5" :weight="micActive ? 'regular' : 'fill'" />
            </button>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
