# @voice-line/transport-ws

Raw WebSocket transport for voice-line.

## Wire protocol

| Frame | Meaning |
|-------|---------|
| Binary | PCM audio (`ArrayBuffer`) |
| Text | JSON `VoiceLineEvent` |

Audio and events never share the same encoding path.

## Client (browser or Node)

```ts
import { WsTransport } from '@voice-line/transport-ws'
import WebSocket from 'ws' // Node only

const transport = new WsTransport({
  url: (sessionId) => `ws://localhost:3001/voice?session=${sessionId}`,
  WebSocketImpl: WebSocket,
})

await transport.connect(sessionId)
```

## Server (accept path)

When a client connects, wrap the socket and hand it to a `Session`:

```ts
import { WebSocketServer } from 'ws'
import { fromWebSocket } from '@voice-line/transport-ws'
import { Session } from '@voice-line/core'

const wss = new WebSocketServer({ port: 3001 })

wss.on('connection', async (socket) => {
  let session: Session | undefined

  const transport = fromWebSocket(socket, {
    onClose: () => { void session?.close() },
  })

  session = new Session({ transport, stt, tts, brain })
  await session.start()
})
```

## Factory

```ts
import { ws } from '@voice-line/transport-ws'
// client-side factory: (sessionId) => Transport
const createTransport = ws({ url: 'ws://localhost:3001' })
```
