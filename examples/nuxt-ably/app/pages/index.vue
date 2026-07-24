<template>
  <main>
    <ClientOnly>
      <AblyVoiceAgent />
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
.boot.error { color: #fecaca; }
</style>
