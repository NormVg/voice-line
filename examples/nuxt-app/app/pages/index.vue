<script setup lang="ts">
const { data, error, pending } = await useFetch<{
  wsUrl: string;
  sampleRate: number;
}>("/api/voice/config");
</script>

<template>
  <main>
    <p v-if="pending" class="boot">Loading voice config…</p>
    <p v-else-if="error" class="boot error">
      Failed to load voice config: {{ error.message }}
    </p>
    <ClientOnly v-else-if="data">
      <VoiceAgent :ws-url="data.wsUrl" :sample-rate="data.sampleRate" />
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
