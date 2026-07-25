# Transports

The `Transport` interface is responsible for moving binary audio chunks and JSON events between the client and server. Transports have absolutely no knowledge of audio formats, VAD, or AI logic.

voice-line ships with two official transports: `ws` (Raw WebSockets) and `ably`.

## 1. WebSocket Transport (`@voice-line/transport-ws`)

The WebSocket transport establishes a raw WebSocket connection directly to your server. It is the fastest and most direct method, but it **requires a persistent Node.js server** (or a framework capable of maintaining persistent WS connections, like Nuxt/Nitro).

*(Note: Raw WebSockets will not work on serverless hosts like Vercel.)*

### Server Setup
```typescript
import { ws } from '@voice-line/transport-ws';
import { createNitroWebSocketHandler } from '@voice-line/server/nitro';

export default defineWebSocketHandler(
  createNitroWebSocketHandler((peer, url) => {
    return {
      transport: ws(), // Mounts the WS transport
      // ... stt, tts, brain
    };
  })
);
```

### Client Setup
```typescript
import { useVoiceAgent } from '@voice-line/react';

const agent = useVoiceAgent({
  serverUrl: 'ws://localhost:3000/api/voice',
  transport: 'ws',
});
```

## 2. Ably Transport (`@voice-line/transport-ably`)

Ably is a realtime messaging platform that acts as a middleman. 
The Ably transport is ideal for **Serverless architectures** (like Vercel) where you cannot host a persistent WebSocket server. Both the client and your serverless function connect to Ably channels, and Ably handles the connection persistence.

### Server Setup
```typescript
import { ably } from '@voice-line/transport-ably';
import { createRouteHandler } from '@voice-line/server/next';

export const POST = createRouteHandler((req) => {
  return {
    transport: ably({ apiKey: process.env.ABLY_API_KEY }),
    // ... stt, tts, brain
  };
});
```

### Client Setup
For Ably, the client requests an authentication token (or payload) from your server endpoint, and then connects to Ably directly.

```typescript
import { useVoiceAgent } from '@voice-line/react';

const agent = useVoiceAgent({
  serverUrl: 'http://localhost:3000/api/voice', // This endpoint handles token generation
  transport: 'ably',
});
```

## Building Custom Transports

You can easily build your own transport (e.g. Socket.io, MQTT) by implementing the `Transport` interface:

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

## Event Protocol

Events are sent as JSON over the `sendEvent` channel. Audio is sent as raw binary frames over the `sendAudio` channel. They are never mixed.

### Server → Client Events

| Event | Payload | When |
|---|---|---|
| `session:ready` | `{ sessionId }` | Transport connected, session initialized |
| `state:change` | `{ state }` | Session state machine transition |
| `transcript:partial` | `{ text }` | STT partial result (for live UI updates) |
| `transcript:final` | `{ text, messageId }` | STT final result — user turn complete |
| `bot:text:delta` | `{ delta, messageId }` | Streaming LLM token (for text UI) |
| `bot:text:done` | `{ text, messageId, partial }` | LLM response complete or interrupted |
| `audio:flush` | `{}` | Stop playback immediately (interruption) |

### Client → Server Events

| Event | Payload | When |
|---|---|---|
| `client:ready` | `{ capabilities }` | Client initialized, ready for audio |
| `text:send` | `{ text }` | User typed a text message (bypasses STT) |
| `mic:toggle` | `{ enabled }` | User muted/unmuted microphone |
