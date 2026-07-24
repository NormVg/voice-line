// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: true },

  // Nuxt 3-compatible layout: app code under app/
  future: {
    compatibilityVersion: 4,
  },

  css: ["~/assets/css/main.css"],

  runtimeConfig: {
    // server-only
    sarvamApiKey: process.env.SARVAM_API_KEY ?? "",
    ollamaApiKey: process.env.OLLAMA_API_KEY ?? "",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "https://ollama.com",
    ollamaModel: process.env.OLLAMA_MODEL ?? "gemma4:31b-cloud",
    voiceWsPort: process.env.VOICE_WS_PORT ?? "3001",
    // public (browser)
    public: {
      voiceWsUrl:
        process.env.NUXT_PUBLIC_VOICE_WS_URL ?? "ws://127.0.0.1:3001/voice",
    },
  },

  vite: {
    optimizeDeps: {
      include: ["@voice-line/client", "@voice-line/vue", "@voice-line/transport-ws"],
    },
  },

  nitro: {
    // voice-line packages are ESM
    externals: {
      inline: [
        "@voice-line/core",
        "@voice-line/provider-sarvam",
        "@voice-line/adapter-ai-sdk",
        "@voice-line/transport-ws",
      ],
    },
  },
});
