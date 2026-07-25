# voice-line Documentation

Welcome to the **voice-line** documentation. voice-line is an open-source TypeScript framework that adds real-time voice to any AI agent. It handles **everything between the microphone and the speaker** — audio capture, streaming, voice activity detection, speech-to-text, text-to-speech, playback, and interruptions.

**voice-line does not include an LLM.** The brain is yours. voice-line gives you transcribed text and expects text back. What happens in between — which model you call, what tools you run, what memory system you use — is entirely your decision.

## Table of Contents

- [Getting Started](./getting-started.md)
  Quickstart guide, installation, and how to build your first voice agent.
- [Architecture & Core Concepts](./architecture.md)
  Deep dive into how voice-line works under the hood (Sessions, Pipelines, VAD, Interruption).
- [Server Integration](./server.md)
  How to integrate voice-line into your backend (Next.js, Nuxt/Nitro) and build stateless endpoints.
- [Client Integration](./client.md)
  How to integrate voice-line into your frontend using Vue or React.
- [Transports](./transports.md)
  Learn about Ably and raw WebSocket transports, and the underlying event protocol.
- [Providers (STT & TTS)](./providers.md)
  Integrating Speech-to-Text and Text-to-Speech engines (like Sarvam AI, Deepgram, ElevenLabs).
- [The Brain & Multi-Agent Architecture](./brain.md)
  How to connect your LLM (using Vercel AI SDK or Eve) and strategies for minimizing latency.

## Key Principles

1. **Bring your own Brain**: voice-line is completely agnostic to your LLM framework.
2. **Streaming by Default**: Everything is stream-based to ensure the absolute lowest possible latency.
3. **No Patchwork**: Strong domain boundaries (Session, Pipeline, Brain, Transport, Provider) keep the codebase modular and extendable.
4. **Sentence Chunking**: Tokens are buffered into natural sentence chunks before TTS for highly natural prosody.
