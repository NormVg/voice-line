

# voice-line

**Real-time voice layer for AI agents. You bring the brain — we handle the ears and mouth.**

> npm install voice-line



> No WebRTC. No infrastructure. Just WebSockets.

---

## Overview

voice-line is an open-source TypeScript framework that adds real-time voice to any AI agent. It handles **everything between the microphone and the speaker** — audio capture, streaming, voice activity detection, speech-to-text, text-to-speech, playback, and interruptions.

**voice-line does not include an LLM.** The brain is yours. voice-line gives you transcribed text and expects text back. What happens in between — which model you call, what tools you run, what memory system you use — is entirely your decision.

---

## Domain Model

voice-line is built around five core abstractions. Every package in the monorepo maps to exactly one of these.

```
┌─────────────────────────────────────────────────────────────────┐
│                          Session                                │
│                                                                 │
│  A single voice conversation between one user and one agent.    │
│  Owns the lifecycle, message history, and state machine.        │
│                                                                 │
│  ┌───────────┐   ┌───────────┐   ┌──────┐   ┌───────────────┐ │
│  │ Transport │──►│  Pipeline  │──►│ Brain│──►│   Pipeline    │ │
│  │           │   │  (Inbound) │   │      │   │  (Outbound)   │ │
│  │ Ably / WS │   │  VAD → STT │   │ You  │   │  TTS → Audio  │ │
│  │           │◄──│            │   │      │◄──│               │ │
│  └───────────┘   └───────────┘   └──────┘   └───────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     Providers                             │  │
│  │  STT: Sarvam, Deepgram, Whisper                          │  │
│  │  TTS: Sarvam, ElevenLabs, OpenAI                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Session

A single voice conversation. Created when a user connects, destroyed when they disconnect. Owns:
- The transport connection (Ably channel or WebSocket)
- The inbound pipeline (audio → text)
- The outbound pipeline (text → audio)
- The message history
- The interruption state machine

### Transport

Moves binary audio chunks and JSON events between client and server. voice-line ships adapters for Ably and raw WebSockets, but any bidirectional channel works. A transport only knows how to `send` and `receive` — it has no knowledge of audio, VAD, or AI.

### Pipeline

The ordered sequence of processors that transform data. There are two pipelines per session:
- **Inbound:** Raw audio → VAD (detect speech boundaries) → STT (transcribe to text)
- **Outbound:** Text tokens → Sentence chunker → TTS (synthesize to audio) → Audio queue

Pipelines are synchronous chains. Each processor receives a frame, transforms it, and passes it to the next processor. This is deliberately simple — no pub/sub, no event bus, no magic.

### Brain

The developer's code. voice-line calls your brain with transcribed text and expects text back (either a string or a streaming async generator). voice-line ships three brain adapters:
- **Callback** — a plain function
- **AI SDK** — wraps Vercel AI SDK's `streamText()`
- **Eve** — connects to an Eve durable agent

### Provider

A pluggable implementation of STT or TTS. Providers are stateless factories — they create streams (STT) or synthesize audio (TTS). They know nothing about sessions, transports, or pipelines.

---

## Architecture

### Package Map

Every package maps to exactly one domain concept. No package crosses boundaries.

```
@voice-line/
├── core                 ← Domain model: Session, Pipeline, types, interfaces
├── server               ← Server runtime: creates sessions, runs pipelines
├── client               ← Browser runtime: mic capture, audio playback, events
│
├── vue                  ← Vue 3 composables (wraps @voice-line/client)
├── react                ← React hooks (wraps @voice-line/client)
│
├── transport-ably       ← Transport: Ably adapter
├── transport-ws         ← Transport: raw WebSocket adapter
│
├── provider-sarvam      ← Provider: Sarvam STT + TTS
├── provider-deepgram    ← Provider: Deepgram STT
├── provider-elevenlabs  ← Provider: ElevenLabs TTS
│
├── adapter-ai-sdk       ← Brain adapter: Vercel AI SDK
└── adapter-eve          ← Brain adapter: Eve framework
```

### Dependency Graph

```
                    @voice-line/core
                    (types, interfaces)
                           │
              ┌────────────┼────────────────┐
              │            │                │
              ▼            ▼                ▼
        /server        /client        /transport-*
        (runtime)      (browser)      (ably, ws)
              │            │
              │       ┌────┴────┐
              │       ▼         ▼
              │    /vue      /react
              │
         ┌────┼──────────┐
         ▼    ▼          ▼
   /provider-*  /adapter-*
   (sarvam,     (ai-sdk,
    deepgram,    eve)
    elevenlabs)
```

Key constraints:
- Everything depends on `core`. Nothing else has cross-dependencies.
- `server` imports transports, providers, and adapters via their interfaces — never their implementations.
- `vue` and `react` wrap `client`. They add framework-specific reactivity, nothing more.
- Providers and adapters are leaf nodes. They depend only on `core`.

---

## Interfaces

These are the contracts that make the system pluggable. Every provider, transport, and brain adapter implements one of these.

### Transport

```typescript
interface Transport {
  connect(sessionId: string): Promise<void>
  disconnect(): Promise<void>

  sendAudio(chunk: ArrayBuffer): void
  onAudio(handler: (chunk: ArrayBuffer) => void): Unsubscribe

  sendEvent(event: VoiceLineEvent): void
  onEvent(handler: (event: VoiceLineEvent) => void): Unsubscribe

  readonly state: 'idle' | 'connecting' | 'connected' | 'disconnected'
}
```

### STT Provider

```typescript
interface STTProvider {
  createStream(config: STTConfig): STTStream
}

interface STTStream {
  write(chunk: ArrayBuffer): void
  on(event: 'transcript', handler: (result: TranscriptResult) => void): void
  on(event: 'error', handler: (error: Error) => void): void
  close(): Promise<void>
}

interface TranscriptResult {
  text: string
  isFinal: boolean
  language: string
  confidence: number
}
```

### TTS Provider

```typescript
interface TTSProvider {
  synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk>
  abort(): void
}

interface AudioChunk {
  data: ArrayBuffer
  sampleRate: number
  format: 'pcm16' | 'opus'
}
```

### Brain

```typescript
/**
 * The developer's LLM logic. voice-line calls this with transcribed text.
 * Return a string for simple responses, or an async generator to stream tokens.
 * Streaming is strongly recommended — it allows TTS to start before the full
 * response is generated, dramatically reducing perceived latency.
 */
type Brain = (
  userText: string,
  context: BrainContext
) => Promise<string> | AsyncGenerator<string>

interface BrainContext {
  sessionId: string
  history: Message[]
  interrupt: () => void
  metadata: Record<string, unknown>
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  partial: boolean  // true if the assistant was interrupted mid-response
}
```

---

## Session Lifecycle

Every voice conversation follows this state machine:

```
  ┌──────┐    connect()    ┌────────────┐
  │ Idle │ ──────────────► │ Connected  │
  └──────┘                 └─────┬──────┘
                                 │
                          client-ready
                                 │
                                 ▼
                           ┌───────────┐
                      ┌───►│ Listening  │◄──────────────┐
                      │    └─────┬─────┘                │
                      │          │                      │
                      │    VAD: speech start             │
                      │          │                      │
                      │          ▼                      │
                      │    ┌───────────┐                │
                      │    │ Receiving │                │
                      │    └─────┬─────┘                │
                      │          │                      │
                      │    VAD: speech end               │
                      │          │                      │
                      │          ▼                      │
                      │    ┌───────────┐                │
                      │    │Processing │  STT → Brain   │
                      │    └─────┬─────┘                │
                      │          │                      │
                      │    brain responds               │
                      │          │                      │
                      │          ▼                      │
                      │    ┌───────────┐                │
                      │    │ Speaking  │ TTS → Audio    │
                      │    └─────┬─────┘                │
                      │          │                      │
                      │    audio finished ───────────────┘
                      │          │
                      │    interrupt (user speaks) ─────┘
                      │
              disconnect()
                      │
                      ▼
                 ┌──────────┐
                 │  Closed  │
                 └──────────┘
```

### Interruption

When the session is in `Speaking` state and the VAD detects user speech:

1. Session transitions back to `Receiving`
2. Outbound pipeline is flushed — TTS generation is aborted, queued audio is discarded
3. The brain's async generator is cancelled (if streaming)
4. The partial assistant message is saved to history with `partial: true`
5. Client receives a `flush` event and stops audio playback
6. Inbound pipeline begins processing the new user utterance

This happens in a single synchronous tick on the server. There is no race condition.

---

## Usage

### Next.js App Router (API Route)

voice-line plugs directly into Next.js using `createRouteHandler`.

```typescript
// app/api/voice/route.ts
import { createRouteHandler } from '@voice-line/server/next'
import { ably } from '@voice-line/transport-ably'
import { sarvam } from '@voice-line/provider-sarvam'

const handler = createRouteHandler({
  transport: ably({ apiKey: process.env.ABLY_API_KEY }),
  stt: sarvam.stt({ language: 'en-IN' }),
  tts: sarvam.tts({ voice: 'anushka' }),

  brain: async function* (userText, ctx) {
    const stream = await callYourLLM(ctx.history, userText)
    for await (const token of stream) yield token
  },
})

export const POST = handler
```

### Nuxt Nitro Route

voice-line plugs directly into Nuxt 3 / Nitro backend routes.

```typescript
// server/api/voice.post.ts
import { createEventHandler } from '@voice-line/server/nitro'
import { ably } from '@voice-line/transport-ably'
import { sarvam } from '@voice-line/provider-sarvam'

export default createEventHandler({
  transport: ably({ apiKey: process.env.ABLY_API_KEY }),
  stt: sarvam.stt({ language: 'en-IN' }),
  tts: sarvam.tts({ voice: 'anushka' }),

  brain: async function* (userText, ctx) {
    const stream = await callYourLLM(ctx.history, userText)
    for await (const token of stream) yield token
  },
})
```

### With Vercel AI SDK

The `adapter-ai-sdk` package wraps `streamText()` into a Brain-compatible async generator.

```typescript
// app/api/voice/route.ts
import { createRouteHandler } from '@voice-line/server/next'
import { ably } from '@voice-line/transport-ably'
import { sarvam } from '@voice-line/provider-sarvam'
import { fromAISDK } from '@voice-line/adapter-ai-sdk'
import { openai } from '@ai-sdk/openai'

export const POST = createRouteHandler({
  transport: ably({ apiKey: process.env.ABLY_API_KEY }),
  stt: sarvam.stt({ language: 'en-IN' }),
  tts: sarvam.tts({ voice: 'anushka' }),

  brain: fromAISDK({
    model: openai('gpt-4o'),
    system: 'You are a helpful voice assistant. Keep responses concise and conversational.',
    tools: {
      getWeather: {
        description: 'Get current weather for a city',
        parameters: z.object({ city: z.string() }),
        execute: async ({ city }) => fetchWeather(city),
      },
    },
  }),
})
```

### With Eve

The `adapter-eve` package connects an Eve durable agent as the brain.

```typescript
// server/api/voice.post.ts (Nuxt Nitro)
import { createEventHandler } from '@voice-line/server/nitro'
import { ably } from '@voice-line/transport-ably'
import { sarvam } from '@voice-line/provider-sarvam'
import { fromEve } from '@voice-line/adapter-eve'

export default createEventHandler({
  transport: ably({ apiKey: process.env.ABLY_API_KEY }),
  stt: sarvam.stt({ language: 'en-IN' }),
  tts: sarvam.tts({ voice: 'anushka' }),

  brain: fromEve({
    agentId: 'support-agent',
    // Eve handles the LLM, memory, tools, skills, and durable workflows internally.
    // voice-line only sees text in → text out.
  }),
})
```

### Frontend — Vue

```vue
<script setup lang="ts">
import { useVoiceAgent } from '@voice-line/vue'

const {
  state,            // 'idle' | 'connecting' | 'listening' | 'receiving' | 'processing' | 'speaking'
  messages,         // Ref<Message[]> — full conversation history, synced across voice and text
  isConnected,      // Computed<boolean>
  isBotSpeaking,    // Computed<boolean>
  connect,          // () => Promise<void>
  disconnect,       // () => void
  toggleMic,        // () => void
  sendText,         // (text: string) => void — type instead of speak, same pipeline
} = useVoiceAgent({
  serverUrl: 'http://localhost:3001',
  transport: 'ably',
  authUrl: '/api/ably-token',
})
</script>
```

### Frontend — React

```tsx
import { useVoiceAgent } from '@voice-line/react'

function VoiceChat() {
  const {
    state, messages, isConnected, isBotSpeaking,
    connect, disconnect, toggleMic, sendText,
  } = useVoiceAgent({
    serverUrl: 'http://localhost:3001',
    transport: 'ably',
    authUrl: '/api/ably-token',
  })

  // Same API surface as Vue. Only the reactivity layer differs.
}
```

---

## Dual-Brain Pattern

The biggest killer of voice UX is latency. A heavy LLM takes 2-5 seconds to start generating. In a voice conversation, 2 seconds of silence feels like an eternity.

voice-line solves this with a built-in `dualBrain` orchestrator that dispatches user text to two brains in parallel:

```
User: "Can you book me a flight to Mumbai tomorrow?"

         ┌──────────── STT ─────────────┐
         │                              │
         ▼                              ▼
  ┌──────────────┐              ┌──────────────┐
  │  Fast Brain  │              │  Heavy Brain │
  │              │              │              │
  │  GPT-4o-mini │              │  Eve Agent   │
  │  ~200ms TTFB │              │  Tools + RAG │
  │              │              │  ~3-10s      │
  │  "Sure! Let  │              │  Searches    │
  │   me check   │              │  flights,    │
  │   flights    │              │  compares    │
  │   for you.." │              │  prices...   │
  └──────┬───────┘              └──────┬───────┘
         │                             │
         ▼                             ▼
    TTS plays                    When ready:
    immediately                  interrupts fast brain,
    (zero dead air)              delivers real answer
```

### How it works

1. User speaks → voice-line transcribes it
2. The same text is sent to both brains simultaneously
3. **Fast Brain** (small, cheap model) responds instantly with a natural acknowledgement → goes straight to TTS
4. **Heavy Brain** (large model, tools, agent workflows) does the real work in the background
5. When the Heavy Brain finishes, it interrupts the Fast Brain and delivers the substantive answer

### Code

```typescript
// server/api/voice.post.ts (Nuxt Nitro)
import { createEventHandler, dualBrain } from '@voice-line/server/nitro'
import { fromAISDK } from '@voice-line/adapter-ai-sdk'
import { fromEve } from '@voice-line/adapter-eve'
import { openai } from '@ai-sdk/openai'

export default createEventHandler({
  transport: ably({ apiKey: process.env.ABLY_API_KEY }),
  stt: sarvam.stt({ language: 'en-IN' }),
  tts: sarvam.tts({ voice: 'anushka' }),

  brain: dualBrain({
    // Responds in ~200ms. Keeps the conversation alive.
    fast: fromAISDK({
      model: openai('gpt-4o-mini'),
      system: `You are the fast-response layer of a voice assistant.
        Acknowledge the user's request naturally in 1-2 sentences.
        Never give a final answer — just buy time while the heavy brain works.`,
    }),

    // Does the real work. Interrupts the fast brain when ready.
    heavy: fromEve({ agentId: 'main-agent' }),

    // When the heavy brain finishes:
    // 'interrupt' — stop the fast brain, deliver real answer (default)
    // 'wait'      — let the fast brain finish, then deliver real answer
    // function    — custom handoff logic
    handoff: 'interrupt',
  }),
})
```

### Custom Handoff

```typescript
brain: dualBrain({
  fast: fromAISDK({ model: openai('gpt-4o-mini') }),
  heavy: fromEve({ agentId: 'main-agent' }),

  handoff: async (fastResult, heavyResult, ctx) => {
    // Simple questions don't need the heavy brain
    if (!heavyResult.usedTools && ctx.history.length < 4) {
      return 'keep-fast'
    }
    return 'interrupt'
  },
})
```

---

## Pipeline Internals

### Inbound Pipeline (Audio → Text)

```
AudioChunk (ArrayBuffer, 100ms)
    │
    ▼
┌──────────────────────┐
│  VADProcessor        │  Silero VAD — detects speech boundaries
│                      │  Emits: speech_start, speech_end
│  On speech_start:    │  → Session transitions to 'receiving'
│  On speech_end:      │  → Passes buffered audio to next processor
└──────────┬───────────┘
           │  AudioBuffer (full utterance)
           ▼
┌──────────────────────┐
│  STTProcessor        │  Streams audio to the configured STT provider
│                      │  Emits partial transcripts for UI updates
│                      │  Emits final transcript when STT confirms
└──────────┬───────────┘
           │  TranscriptResult { text, isFinal }
           ▼
       Session calls brain(text, context)
```

### Outbound Pipeline (Text → Audio)

```
string token (from brain's async generator)
    │
    ▼
┌──────────────────────┐
│  SentenceChunker     │  Buffers tokens until a sentence boundary
│                      │  (period, question mark, newline, or 150 chars)
│                      │  Emits complete sentence chunks for natural TTS
└──────────┬───────────┘
           │  string (complete sentence)
           ▼
┌──────────────────────┐
│  TTSProcessor        │  Sends sentence to TTS provider
│                      │  Receives streaming audio chunks
│                      │  Forwards to transport for playback
└──────────┬───────────┘
           │  AudioChunk (ArrayBuffer)
           ▼
       Transport sends to client
       Client plays through speakers
```

### Why Sentence Chunking Matters

Without chunking, you would TTS each individual token ("Sure", "!", " Let", " me", ...) — producing choppy, robotic audio. By buffering to sentence boundaries, TTS receives natural phrases and produces smooth, human-sounding speech.

The chunker balances two tensions:
- **Shorter chunks** = lower latency (start speaking sooner)
- **Longer chunks** = better prosody (more natural sounding)

Default: flush on sentence-ending punctuation, or after 150 characters, whichever comes first.

---

## Event Protocol

Client and server communicate via JSON events over the transport's event channel.

### Server → Client

| Event | Payload | When |
|---|---|---|
| `session:ready` | `{ sessionId }` | Transport connected, session initialized |
| `state:change` | `{ state }` | Session state machine transition |
| `transcript:partial` | `{ text }` | STT partial result (for live UI updates) |
| `transcript:final` | `{ text, messageId }` | STT final result — user turn complete |
| `bot:text:delta` | `{ delta, messageId }` | Streaming LLM token (for text UI) |
| `bot:text:done` | `{ text, messageId, partial }` | LLM response complete or interrupted |
| `audio:flush` | `{}` | Stop playback immediately (interruption) |

### Client → Server

| Event | Payload | When |
|---|---|---|
| `client:ready` | `{ capabilities }` | Client initialized, ready for audio |
| `text:send` | `{ text }` | User typed a text message (bypasses STT) |
| `mic:toggle` | `{ enabled }` | User muted/unmuted microphone |

Audio is sent as raw binary frames on a separate channel — never mixed with JSON events.

---

## Configuration Reference

```typescript
interface VoiceLineServerConfig {
  // Required
  transport: Transport
  stt: STTProvider
  tts: TTSProvider
  brain: Brain

  // Audio
  sampleRate?: number           // Default: 16000 (16kHz)
  audioFormat?: 'pcm16' | 'opus' // Default: 'pcm16'
  chunkDurationMs?: number      // Default: 100

  // VAD
  vad?: {
    confidence?: number         // Default: 0.7
    silenceMs?: number          // Default: 500
    minSpeechMs?: number        // Default: 200
  }

  // Sentence chunker
  chunker?: {
    maxChars?: number           // Default: 150
    flushOnPunctuation?: boolean // Default: true
  }

  // Session
  session?: {
    maxDurationMs?: number      // Default: 1800000 (30 min)
    idleTimeoutMs?: number      // Default: 60000 (1 min)
  }

  // Hooks
  onSessionStart?: (session: Session) => void
  onSessionEnd?: (session: Session) => void
  onError?: (error: Error, session?: Session) => void
}
```

---

## Monorepo Structure

```
voice-line/
├── packages/
│   ├── core/                     # Domain model, types, interfaces
│   │   └── src/
│   │       ├── types.ts          # Message, AudioChunk, TranscriptResult
│   │       ├── interfaces/
│   │       │   ├── transport.ts  # Transport interface
│   │       │   ├── stt.ts        # STTProvider, STTStream
│   │       │   ├── tts.ts        # TTSProvider
│   │       │   └── brain.ts      # Brain, BrainContext
│   │       ├── pipeline/
│   │       │   ├── processor.ts  # Base Processor class
│   │       │   ├── vad.ts        # VADProcessor
│   │       │   ├── chunker.ts    # SentenceChunker
│   │       │   └── pipeline.ts   # Pipeline (ordered chain of processors)
│   │       ├── session/
│   │       │   ├── session.ts    # Session state machine
│   │       │   └── history.ts    # Message history manager
│   │       └── utils/
│   │           └── audio.ts      # PCM encoding/decoding, resampling
│   │
│   ├── server/                   # Server runtime
│   │   └── src/
│   │       ├── server.ts         # createServer() — entry point
│   │       ├── session-manager.ts # Creates/destroys sessions
│   │       └── dual-brain.ts     # dualBrain() orchestrator
│   │
│   ├── client/                   # Browser runtime (framework-agnostic)
│   │   └── src/
│   │       ├── client.ts         # VoiceLineClient class
│   │       ├── mic.ts            # Microphone capture (MediaStream API)
│   │       ├── speaker.ts        # Audio playback (Web Audio API)
│   │       └── events.ts         # Event parsing and dispatch
│   │
│   ├── vue/                      # Vue 3 composables
│   │   └── src/
│   │       ├── useVoiceAgent.ts
│   │       └── useVoiceTranscript.ts
│   │
│   ├── react/                    # React hooks
│   │   └── src/
│   │       ├── useVoiceAgent.ts
│   │       └── useVoiceTranscript.ts
│   │
│   ├── transport-ably/           # Ably adapter
│   │   └── src/
│   │       └── ably.ts           # implements Transport
│   │
│   ├── transport-ws/             # Raw WebSocket adapter
│   │   └── src/
│   │       └── ws.ts             # implements Transport
│   │
│   ├── provider-sarvam/          # Sarvam STT + TTS
│   │   └── src/
│   │       ├── stt.ts            # implements STTProvider
│   │       └── tts.ts            # implements TTSProvider
│   │
│   ├── adapter-ai-sdk/           # Vercel AI SDK → Brain
│   │   └── src/
│   │       └── ai-sdk.ts         # fromAISDK() — wraps streamText into a Brain
│   │
│   └── adapter-eve/              # Eve → Brain
│       └── src/
│           └── eve.ts            # fromEve() — wraps Eve agent into a Brain
│
├── examples/
│   ├── standalone/               # Minimal: callback brain + Ably + Sarvam
│   ├── with-ai-sdk/              # AI SDK brain + tool calling
│   ├── with-eve/                 # Eve agent brain
│   ├── dual-brain/               # Fast + heavy brain pattern
│   └── nuxt-app/                 # Full Nuxt app with voice-line/vue
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

## Roadmap

### Phase 1 — Foundation
- [x] `@voice-line/core` — types, interfaces, pipeline, session, VAD, chunker
- [x] `@voice-line/server` — server runtime, session manager
- [x] `@voice-line/client` — browser runtime, mic, speaker
- [x] `@voice-line/transport-ably` — Ably adapter
- [x] `@voice-line/provider-sarvam` — Sarvam STT + TTS

### Phase 2 — Framework Adapters
- [x] `@voice-line/vue` — Vue 3 composables
- [x] `@voice-line/react` — React hooks
- [x] `@voice-line/adapter-ai-sdk` — Vercel AI SDK brain adapter
- [ ] `@voice-line/adapter-eve` — Eve brain adapter

### Phase 3 — Dual-Brain & Polish
- [x] `dualBrain()` orchestrator in `@voice-line/server`
- [x] Custom handoff logic
- [x] `@voice-line/transport-ws` — raw WebSocket client + `fromWebSocket` server accept path
- [x] WS integration tests (events, audio, full session text/voice turns, interrupt)
- [x] `examples/standalone` — minimal WS demo (mock STT/TTS + callback brain)
- [x] `examples/nuxt-app` — Nuxt + WebSocket + Sarvam + AI SDK
- [ ] `examples/` — remaining demo apps (eve, dual-brain, Ably)

### Phase 4 — Ecosystem
- [x] `@voice-line/transport-ws` — raw WebSocket adapter
- [ ] `@voice-line/provider-elevenlabs` — ElevenLabs TTS


---

## Contributing

voice-line is open source. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT
