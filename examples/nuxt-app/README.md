# voice-line · Nuxt + WebSocket + Sarvam + AI SDK

End-to-end voice agent example:

| Layer | Implementation |
|-------|----------------|
| App | Nuxt 3/4 (Vue) |
| Transport | Raw WebSocket (`@voice-line/transport-ws`) |
| STT / TTS | Sarvam Saaras + Bulbul (`@voice-line/provider-sarvam`) |
| Brain | Vercel AI SDK (`@voice-line/adapter-ai-sdk` + Ollama Cloud) |

```
Browser (mic / speaker)
    │  WsTransport  binary audio + JSON events
    ▼
WebSocket :3001/voice  ── Session ──► Sarvam STT
                          │
                          ▼
                     AI SDK (LLM)
                          │
                          ▼
                       Sarvam TTS ──► audio back to browser
```

Nuxt HTTP stays on **:3000**. Voice sessions run on a long-lived WS server (**:3001**) started by a Nitro plugin. That avoids serverless request lifetime issues.

---

## Setup

From the monorepo root:

```bash
pnpm install
pnpm build
cp examples/nuxt-app/.env.example examples/nuxt-app/.env
# edit .env — set SARVAM_API_KEY and OLLAMA_API_KEY
pnpm --filter @voice-line/example-nuxt-app dev
```

Open [http://localhost:3000](http://localhost:3000).

### Env

| Variable | Required | Purpose |
|----------|----------|---------|
| `SARVAM_API_KEY` | yes (for real STT/TTS) | Sarvam API subscription key |
| `OLLAMA_API_KEY` | yes (for real LLM) | Ollama Cloud API key |
| `OLLAMA_BASE_URL` | no | default `https://ollama.com` |
| `OLLAMA_MODEL` | no | default `gemma4:31b-cloud` |
| `VOICE_WS_PORT` | no | default `3001` |
| `NUXT_PUBLIC_VOICE_WS_URL` | no | default `ws://127.0.0.1:3001/voice` |

Without `OLLAMA_API_KEY`, the brain falls back to a local echo so you can still test transport + UI.  
Without `SARVAM_API_KEY`, STT/TTS calls will fail (text path still exercises the session if you type).

---

## Usage

1. Click **Connect** (allows microphone when prompted).
2. Speak — VAD detects end of utterance → Sarvam STT → LLM → Sarvam TTS.
3. Or type in the box and hit **Send** (bypasses STT, same brain + TTS).
4. **Barge-in:** while the bot is speaking, talk over it or type a new message — playback flushes and a new turn starts. Headphones work best.
5. Server enforces `maxSessions: 20` and drops outbound audio under WS backpressure (~256KB).

---

## Project layout

```
examples/nuxt-app/
├── app/
│   ├── pages/index.vue          # loads config, mounts VoiceAgent
│   ├── components/VoiceAgent.vue
│   └── assets/css/main.css
├── server/
│   ├── plugins/voice-ws.ts      # starts WS + Session per connection
│   ├── utils/voice-stack.ts     # sarvam + Ollama Cloud (fromAISDK)
│   └── api/voice/config.get.ts  # public wsUrl for the client
├── nuxt.config.ts
└── .env.example
```

---

## Architecture notes

- **Leaf packages stay leaf** — the Nuxt app composes `@voice-line/*`; it does not break domain boundaries.
- **Server never hardcodes providers inside core** — `Session` only sees `STTProvider` / `TTSProvider` / `Brain`.
- **Deploy:** this WS plugin needs a long-lived Node process (`node-server` / Docker / bare metal). Pure serverless Nitro is not enough for raw WS sessions; use Ably later if you need multi-instance serverless.
