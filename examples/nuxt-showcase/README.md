# voice-line · Nuxt Showcase

Polished demo of `@voice-line/*` over a raw WebSocket:

| Layer | Implementation |
|-------|----------------|
| App | Nuxt 4 + Vue 3 |
| Transport | `@voice-line/transport-ws` |
| STT / TTS | Sarvam Saaras + Bulbul |
| Brain | Vercel AI SDK + Ollama Cloud (or echo fallback) |

## Features exercised

- **Barge-in** — speak or type while the bot is talking; audio flushes and the turn aborts
- **Shared providers** — one STT/TTS instance for all peers (per-turn `AbortSignal`)
- **Session cap** — `maxSessions: 20` process-wide via Nitro handler
- **Backpressure** — outbound audio dropped if the socket buffer exceeds 256KB
- **Text interrupt** — composer uses the same brain path as voice

## Setup

From the monorepo root:

```bash
pnpm install
pnpm build
# optional env in examples/nuxt-showcase/.env
# SARVAM_API_KEY=...
# OLLAMA_API_KEY=...
pnpm --filter nuxt-showcase dev
```

Open [http://localhost:3000](http://localhost:3000).

### Env

| Variable | Required | Purpose |
|----------|----------|---------|
| `SARVAM_API_KEY` | for real STT/TTS | Sarvam subscription key |
| `OLLAMA_API_KEY` | for real LLM | Ollama Cloud API key |
| `OLLAMA_BASE_URL` | no | default `https://ollama.com` |
| `OLLAMA_MODEL` | no | default `gpt-oss:20b-cloud` |

Without Ollama keys the brain echoes. Without Sarvam, STT/TTS will fail (text path still works for session plumbing).

## Usage

1. **Initialize Session** — allow the microphone.
2. Speak — VAD → STT → LLM → TTS.
3. While the bot speaks, **talk over it** (headphones best) or type a new message to barge-in.
4. Partial assistant messages show a red interrupt marker.

## Layout

```
examples/nuxt-showcase/
├── app/app.vue                 # UI + useVoiceAgent
├── server/routes/_ws.ts        # Nitro WS + voice-line session
├── nuxt.config.ts
└── README.md
```
