# voice-line

**Real-time voice layer for AI agents. You bring the brain — we handle the ears and mouth.**

> No WebRTC. No infrastructure. Just WebSockets.

voice-line is a TypeScript monorepo that sits between the microphone and the speaker: capture, VAD, STT, your LLM, TTS, playback, and interruptions.

Full architecture: [project.md](./project.md) · Agent rules: [AGENTS.md](./AGENTS.md)

---

## Packages

| Package | Role |
|---------|------|
| `@voice-line/core` | Domain: types, interfaces, Pipeline, Session, VAD, chunker |
| `@voice-line/server` | Runtime, session manager, `dualBrain`, Next/Nitro handlers |
| `@voice-line/client` | Browser: mic, speaker, `VoiceLineClient` |
| `@voice-line/vue` | Vue 3 `useVoiceAgent` |
| `@voice-line/react` | React `useVoiceAgent` |
| `@voice-line/transport-ws` | Raw WebSocket transport |
| `@voice-line/transport-ably` | Ably transport |
| `@voice-line/provider-sarvam` | Sarvam STT (Saaras) + TTS (Bulbul) |
| `@voice-line/adapter-ai-sdk` | Vercel AI SDK → Brain |

---

## Domain model

Five abstractions. Every package maps to exactly one:

```
Session
  ├── Transport   (Ably / WS)     — bytes + events only
  ├── Pipeline    (in / out)      — ordered processors
  ├── Brain       (your LLM)      — text in, tokens out
  └── Providers   (STT / TTS)     — leaf implementations
```

**Dependency rule:** everything depends on `core`. Server never imports concrete providers. Leaves import only `core`.

---

## Quick start (server)

```ts
import { createServer } from '@voice-line/server'
import { ably } from '@voice-line/transport-ably'
import { sarvam } from '@voice-line/provider-sarvam'

const server = createServer({
  transport: ably({ apiKey: process.env.ABLY_API_KEY }),
  stt: sarvam.stt({ language: 'en-IN' }),
  tts: sarvam.tts({ voice: 'shubh' }),
  brain: async function* (userText) {
    yield `You said: ${userText}`
  },
})

const session = await server.createSession()
```

### Next.js

```ts
// app/api/voice/route.ts
import { createRouteHandler } from '@voice-line/server/next'
import { ably } from '@voice-line/transport-ably'
import { sarvam } from '@voice-line/provider-sarvam'

export const POST = createRouteHandler({
  transport: ably({ apiKey: process.env.ABLY_API_KEY }),
  stt: sarvam.stt({ language: 'en-IN' }),
  tts: sarvam.tts({ voice: 'shubh' }),
  brain: async function* (text) {
    yield `Echo: ${text}`
  },
})
```

### Dual-brain (kill dead air)

```ts
import { dualBrain } from '@voice-line/server'
import { fromAISDK } from '@voice-line/adapter-ai-sdk'

brain: dualBrain({
  fast: fromAISDK({ model: openai('gpt-4o-mini'), system: 'Ack briefly.' }),
  heavy: fromAISDK({ model: openai('gpt-4o'), system: 'Answer fully.' }),
  handoff: 'interrupt',
})
```

---

## Quick start (client)

```ts
import { VoiceLineClient } from '@voice-line/client'
import { ably } from '@voice-line/transport-ably'

const client = new VoiceLineClient({
  transport: ably({ authUrl: '/api/ably-token' }),
})

await client.connect(sessionId)
client.sendText('Hello!')
```

Vue / React:

```ts
import { useVoiceAgent } from '@voice-line/vue' // or '@voice-line/react'
```

---

## Examples

| Example | Stack |
|---------|--------|
| `examples/standalone` | Raw WS + mock STT/TTS + callback brain |
| `examples/nuxt-app` | **Nuxt + WebSocket + Sarvam + Ollama Cloud (AI SDK)** |

```bash
# Nuxt voice agent
cp examples/nuxt-app/.env.example examples/nuxt-app/.env
# set SARVAM_API_KEY + OLLAMA_API_KEY
pnpm --filter @voice-line/example-nuxt-app dev
# → http://localhost:3000  (voice WS on :3001)
```

## Develop

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Requirements: Node ≥ 20, pnpm 9.

---

## License

MIT
