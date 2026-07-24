# Transports

A **Transport** is responsible for moving binary audio chunks and JSON events between the client and the server. It does not know anything about VAD, STT, or LLMs. It only knows how to `send` and `receive`.

`voice-line` ships with two officially supported transports.

---

## 1. WebSockets (`@voice-line/transport-ws`)

The WebSocket transport is the most direct and lowest latency option. It requires a long-running Node.js server (like Nuxt Nitro, Express, or a custom HTTP server) to keep the connection alive.

> [!WARNING] Next.js Compatibility
> WebSockets are **not** supported on Vercel Serverless environments. If you are deploying a Next.js app to Vercel, you must use the **Ably Transport** instead.

### Installation

```bash
npm install @voice-line/transport-ws
```

### Server Usage (Nuxt Nitro)

We provide a `createNitroWebSocketHandler` utility that handles all the boilerplate of upgrading the connection and hooking into the Nitro peer lifecycle.

```typescript
import { createNitroWebSocketHandler } from '@voice-line/server/nitro'
import { ws } from '@voice-line/transport-ws'

export default defineWebSocketHandler(
  createNitroWebSocketHandler(async (peer, url) => {
    return {
      transport: ws(peer), // Pass the Nitro peer directly
      stt: /* ... */,
      tts: /* ... */,
      brain: /* ... */
    }
  })
)
```

### Client Usage

```typescript
import { useVoiceAgent } from '@voice-line/vue' // or @voice-line/react

const agent = useVoiceAgent({
  serverUrl: 'ws://localhost:3000/_ws',
  transport: 'ws'
})
```

---

## 2. Ably (`@voice-line/transport-ably`)

Ably is a real-time pub/sub platform. By using Ably as the transport layer, you can build serverless voice agents. The client and server never connect directly to each other; they both connect to an Ably Channel.

This is the **recommended transport for Next.js and Vercel deployments**.

### Installation

```bash
npm install @voice-line/transport-ably ably
```

### Server Usage

The server creates an Ably Token Request and passes it to the client payload.

```typescript
import { createRouteHandler } from '@voice-line/server/next'
import { ably } from '@voice-line/transport-ably'

export const POST = createRouteHandler({
  transport: ably({ apiKey: process.env.ABLY_API_KEY }),
  stt: /* ... */,
  tts: /* ... */,
  brain: /* ... */
})
```

### Client Usage

On the client side, use `createAblyClientSession` to hit your API route, retrieve the auth token, and initialize the Ably Realtime client.

```typescript
import { useVoiceAgent } from '@voice-line/react'
import { createAblyClientSession } from '@voice-line/transport-ably'
import Ably from 'ably'

const agent = useVoiceAgent({
  session: createAblyClientSession('/api/session', Ably.Realtime)
})
```
