# Getting Started

This guide will walk you through setting up a complete voice-line application using **Next.js** (for the backend) and **React** (for the frontend). We will use raw WebSockets for the transport, Sarvam AI for speech services, and the Vercel AI SDK for the brain.

## Prerequisites

- Node.js >= 20
- pnpm (recommended)
- An API key for your LLM (e.g., `OPENAI_API_KEY`)
- An API key for your speech provider (e.g., `SARVAM_API_KEY`)

## 1. Installation

Install the required voice-line packages along with the AI SDK and OpenAI provider:

```bash
npm install @voice-line/server @voice-line/transport-ws @voice-line/provider-sarvam @voice-line/adapter-ai-sdk
npm install @ai-sdk/openai ai
```

For the frontend, install the React bindings:

```bash
npm install @voice-line/react
```

## 2. Server Setup (Next.js)

voice-line provides a zero-boilerplate WebSocket handler for Next.js. You can export it directly from an API route. 

*(Note: Next.js WebSockets work best with persistent Node servers. For serverless deployments like Vercel, consider using the Ably transport instead).*

Create `app/api/voice/route.ts`:

```typescript
import { createNextWebSocketHandler } from '@voice-line/server/next';
import { ws } from '@voice-line/transport-ws';
import { sarvam } from '@voice-line/provider-sarvam';
import { fromAISDK } from '@voice-line/adapter-ai-sdk';
import { openai } from '@ai-sdk/openai';

// This handler will automatically upgrade incoming WS connections
export const SOCKET = createNextWebSocketHandler((clientUrl) => {
  return {
    // 1. Transport: Raw WebSockets
    transport: ws(),
    
    // 2. Providers: Sarvam AI for Indian language STT/TTS
    stt: sarvam.stt({ 
      apiKey: process.env.SARVAM_API_KEY, 
      language: 'en-IN' 
    }),
    tts: sarvam.tts({ 
      apiKey: process.env.SARVAM_API_KEY, 
      voice: 'anushka' 
    }),

    // 3. Brain: Vercel AI SDK
    brain: fromAISDK({
      model: openai('gpt-4o-mini'),
      system: 'You are a helpful and concise voice assistant. Keep answers brief.',
    }),
  };
});
```

## 3. Client Setup (React)

Use the `useVoiceAgent` hook to connect to your server and manage the voice session.

Create a component, e.g., `components/VoiceChat.tsx`:

```tsx
'use client';
import { useVoiceAgent } from '@voice-line/react';

export default function VoiceChat() {
  const {
    state,
    messages,
    isConnected,
    isBotSpeaking,
    connect,
    disconnect,
    toggleMic,
  } = useVoiceAgent({
    serverUrl: 'ws://localhost:3000/api/voice',
    transport: 'ws',
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-4">
        {!isConnected ? (
          <button onClick={connect} className="bg-blue-500 text-white px-4 py-2 rounded">
            Connect
          </button>
        ) : (
          <button onClick={disconnect} className="bg-red-500 text-white px-4 py-2 rounded">
            Disconnect
          </button>
        )}
        
        <button onClick={toggleMic} disabled={!isConnected} className="border px-4 py-2 rounded">
          Toggle Mic
        </button>
      </div>

      <div className="text-sm text-gray-500">
        Status: {state} {isBotSpeaking && '(Speaking)'}
      </div>

      <div className="space-y-2 mt-4">
        {messages.map(msg => (
          <div key={msg.id} className={msg.role === 'user' ? 'text-right' : 'text-left'}>
            <span className={`inline-block p-2 rounded ${msg.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'}`}>
              {msg.content}
            </span>
            {msg.partial && <span className="text-xs text-red-500 ml-2">(Interrupted)</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

## 4. Run your App

1. Ensure your API keys are in `.env.local`:
```
OPENAI_API_KEY=your_openai_key
SARVAM_API_KEY=your_sarvam_key
```

2. Start your development server:
```bash
npm run dev
```

3. Visit your page, click **Connect**, and start speaking!

---

### Next Steps

- Learn how the [Architecture](./architecture.md) handles interruptions seamlessly.
- See how to use [Tools and Multi-Agent setups](./brain.md).
- Switch to the [Ably Transport](./transports.md) if deploying to Vercel Serverless.
