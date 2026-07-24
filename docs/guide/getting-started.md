# Getting Started

`voice-line` is designed to be transport-agnostic and framework-agnostic, but we provide first-class adapters for Next.js, Nuxt, React, and Vue.

## Installation

Install the core package along with the transport, provider, and framework adapters you need. 

For example, to build a Nuxt app using WebSockets, Sarvam AI for voice, and the Vercel AI SDK for the brain:

```bash
npm install @voice-line/server @voice-line/transport-ws @voice-line/provider-sarvam @voice-line/adapter-ai-sdk
npm install @voice-line/vue @voice-line/client
```

## Quick Start: Nuxt + WebSockets

Here is a complete example of a Nuxt 3 backend utilizing WebSockets, Sarvam AI, and the Vercel AI SDK.

### 1. Server Route (`server/routes/_ws.ts`)

Create a zero-boilerplate WebSocket handler using `createNitroWebSocketHandler`:

```typescript
import { createNitroWebSocketHandler } from '@voice-line/server/nitro'
import { ws } from '@voice-line/transport-ws'
import { sarvam } from '@voice-line/provider-sarvam'
import { fromAISDK } from '@voice-line/adapter-ai-sdk'
import { openai } from '@ai-sdk/openai'

export default defineWebSocketHandler(
  createNitroWebSocketHandler(async (peer, url) => {
    return {
      // 1. WebSocket Transport
      transport: ws(peer),
      
      // 2. STT & TTS Providers
      stt: sarvam.stt({ language: 'en-IN' }),
      tts: sarvam.tts({ voice: 'anushka' }),

      // 3. Your LLM Brain
      brain: fromAISDK({
        model: openai('gpt-4o-mini'),
        system: 'You are a helpful voice assistant. Keep responses conversational and brief.',
      }),
      
      onSessionStart: (session) => console.log('Session started:', session.id),
      onSessionEnd: (session) => console.log('Session ended:', session.id),
      onError: (err) => console.error('Session error:', err)
    }
  })
)
```

### 2. Frontend Component (`app.vue`)

Use the `useVoiceAgent` Vue composable to connect to your backend:

```vue
<script setup lang="ts">
import { useVoiceAgent } from '@voice-line/vue'

const { state, connect, disconnect, isConnected, toggleMic } = useVoiceAgent({
  serverUrl: 'ws://localhost:3000/_ws',
  transport: 'ws'
})
</script>

<template>
  <div>
    <h1>Voice Agent</h1>
    
    <div v-if="!isConnected">
      <button @click="connect">Start Conversation</button>
    </div>
    <div v-else>
      <p>Status: {{ state }}</p>
      <button @click="toggleMic">Toggle Microphone</button>
      <button @click="disconnect">End Conversation</button>
    </div>
  </div>
</template>
```

That's it! You now have a fully functioning, low-latency, interruptible voice agent.

## Quick Start: Next.js + Ably

Next.js Serverless deployments (like Vercel) do not support persistent WebSockets. For Next.js, we highly recommend using the **Ably Transport**.

### 1. API Route (`app/api/session/route.ts`)

```typescript
import { createRouteHandler } from '@voice-line/server/next'
import { ably } from '@voice-line/transport-ably'
import { sarvam } from '@voice-line/provider-sarvam'
import { fromAISDK } from '@voice-line/adapter-ai-sdk'
import { openai } from '@ai-sdk/openai'

export const POST = createRouteHandler({
  transport: ably({ apiKey: process.env.ABLY_API_KEY }),
  stt: sarvam.stt({ language: 'en-IN' }),
  tts: sarvam.tts({ voice: 'shubh' }),
  brain: fromAISDK({
    model: openai('gpt-4o-mini'),
    system: 'You are a fast voice assistant.',
  }),
})
```

### 2. Frontend Component (`page.tsx`)

```tsx
'use client'

import { useVoiceAgent } from '@voice-line/react'
import { createAblyClientSession } from '@voice-line/transport-ably'
import Ably from 'ably'

export default function VoiceChat() {
  const { state, isConnected, connect, disconnect } = useVoiceAgent({
    session: createAblyClientSession('/api/session', Ably.Realtime)
  })

  return (
    <div>
      <p>Status: {state}</p>
      {!isConnected ? (
        <button onClick={connect}>Start</button>
      ) : (
        <button onClick={disconnect}>Stop</button>
      )}
    </div>
  )
}
```
