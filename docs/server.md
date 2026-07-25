# Server Integration

The `@voice-line/server` package provides the backend runtime for your voice sessions. It manages the session lifecycles and provides zero-boilerplate wrappers for popular frameworks.

## Framework Handlers

voice-line provides direct integrations for Next.js and Nuxt/Nitro, meaning you do not have to write custom WebSocket upgrade logic or manage session mappings yourself.

### Nuxt / Nitro
Import `createNitroWebSocketHandler` and `createEventHandler` from `@voice-line/server/nitro`.

```typescript
// server/routes/_ws.ts
import { createNitroWebSocketHandler } from '@voice-line/server/nitro';
import { ws } from '@voice-line/transport-ws';
import { sarvam } from '@voice-line/provider-sarvam';
// ... other imports

export default defineWebSocketHandler(
  createNitroWebSocketHandler((peer, url) => {
    return {
      transport: ws(),
      stt: sarvam.stt({ language: 'en-IN' }),
      tts: sarvam.tts({ voice: 'anushka' }),
      brain: /* your brain */,
    };
  })
);
```

### Next.js App Router
Import `createNextWebSocketHandler` and `createRouteHandler` from `@voice-line/server/next`.

```typescript
// app/api/voice/route.ts
import { createNextWebSocketHandler } from '@voice-line/server/next';
import { ws } from '@voice-line/transport-ws';
import { sarvam } from '@voice-line/provider-sarvam';

export const SOCKET = createNextWebSocketHandler((clientUrl) => {
  return {
    transport: ws(),
    stt: sarvam.stt({ language: 'en-IN' }),
    tts: sarvam.tts({ voice: 'anushka' }),
    brain: /* your brain */,
  };
});
```

*(Note: Next.js requires a persistent server or a package like `next-ws` to support WebSockets. For Vercel Serverless deployments, use the Ably transport instead of raw WebSockets).*

## Configuration Options

The configuration object returned by your factory (`VoiceLineServerConfig`) requires 4 core properties:

```typescript
interface VoiceLineServerConfig {
  // 1. Transport implementation (e.g. ws(), ably())
  transport: Transport | TransportFactory;
  
  // 2. Speech-to-Text provider
  stt: STTProvider;
  
  // 3. Text-to-Speech provider
  tts: TTSProvider;
  
  // 4. AI Brain
  brain: Brain;

  // Optional: Advanced Tuning
  audio?: Partial<AudioConfig>;
  vad?: Partial<VADConfig>;
  chunker?: Partial<ChunkerConfig>;
  session?: Partial<SessionConfig>;
  
  // Optional: Hooks
  onSessionStart?: (session: Session) => void;
  onSessionEnd?: (session: Session) => void;
  onError?: (error: Error, session?: Session) => void;
}
```

## Stateless APIs

Sometimes you don't need a real-time WebSocket connection. You might just want to convert text to speech, or process a single audio file in a push-to-talk manner. 

voice-line provides orchestrators for these scenarios via standard HTTP handlers.

### Standalone TTS
Expose your TTS provider as a REST API endpoint.

```typescript
// server/api/tts.post.ts (Nuxt Nitro)
import { createTTSHandler } from '@voice-line/server/nitro';
import { sarvam } from '@voice-line/provider-sarvam';

export default createTTSHandler({
  tts: sarvam.tts({ voice: 'anushka' }),
});
```
*Client sends POST with `{ text: "Hello" }`, Server responds with `audio/pcm` stream.*

### Push-to-Talk (Stateless)
Process a single audio file through the STT → Brain → TTS pipeline in one shot.

```typescript
// server/api/talk.post.ts (Nuxt Nitro)
import { createStatelessHandler } from '@voice-line/server/nitro';
import { sarvam } from '@voice-line/provider-sarvam';
import { fromAISDK } from '@voice-line/adapter-ai-sdk';
import { openai } from '@ai-sdk/openai';

export default createStatelessHandler({
  stt: sarvam.stt({ language: 'en-IN' }),
  tts: sarvam.tts({ voice: 'anushka' }),
  brain: fromAISDK({ model: openai('gpt-4o-mini') })
});
```
*Client POSTs raw binary audio, Server responds with `audio/pcm` stream containing the AI's response.*
