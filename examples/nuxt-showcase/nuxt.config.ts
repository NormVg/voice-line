import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  
  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    sarvamApiKey: process.env.SARVAM_API_KEY ?? "",
    ollamaApiKey: process.env.OLLAMA_API_KEY ?? "",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "https://ollama.com",
    ollamaModel: process.env.OLLAMA_MODEL ?? "gemma4:31b-cloud",
  },
  
  vite: {
    plugins: [
      tailwindcss(),
    ],
  },
  
  nitro: {
    experimental: {
      websocket: true,
    },
  },
})
