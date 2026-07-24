<script setup lang="ts">
import { ref, onMounted } from 'vue';

const wsUrl = ref("");
const sampleRate = 16_000;

onMounted(() => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.value = `${protocol}//${window.location.host}/_ws`;
});
</script>

<template>
  <main>
    <ClientOnly>
      <VoiceAgent v-if="wsUrl" :ws-url="wsUrl" :sample-rate="sampleRate" />
      <template #fallback>
        <p class="boot">Starting client…</p>
      </template>
    </ClientOnly>
  </main>
</template>

<style scoped>
.boot {
  max-width: 40rem;
  margin: 4rem auto;
  padding: 0 1rem;
  color: var(--muted);
  text-align: center;
}
.boot.error {
  color: #fecaca;
}
</style>
