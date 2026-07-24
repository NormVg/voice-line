# @voice-line/server

Server runtime for voice-line. Creates sessions, runs pipelines, and exposes framework entry points.

- `createServer(config)` — core runtime
- `dualBrain({ fast, heavy })` — low-latency ack + heavy answer
- `@voice-line/server/next` — Next.js App Router handler
- `@voice-line/server/nitro` — Nuxt/Nitro handler

Depends only on `@voice-line/core`. Inject transports, STT, TTS, and brains at the call site.
