# Client Integration

voice-line provides official client bindings for Vue 3 and React. Both wrappers expose the identical underlying `@voice-line/client` class, offering a unified API surface.

## React (`@voice-line/react`)

Use the `useVoiceAgent` hook to manage the connection, audio capture, playback, and session state.

```tsx
import { useVoiceAgent } from '@voice-line/react';

function VoiceChat() {
  const {
    state,            // 'idle' | 'connecting' | 'listening' | 'receiving' | 'processing' | 'speaking'
    messages,         // Array of Message objects (synced across voice and text)
    isConnected,      // boolean
    isBotSpeaking,    // boolean
    connect,          // () => Promise<void>
    disconnect,       // () => void
    toggleMic,        // () => void
    sendText,         // (text: string) => void (Bypasses STT, acts as user input)
  } = useVoiceAgent({
    serverUrl: 'ws://localhost:3000/api/voice', // Your WebSocket endpoint
    transport: 'ws',                            // 'ws' or 'ably'
  });

  return (
    <div>
      <button onClick={isConnected ? disconnect : connect}>
        {isConnected ? 'Disconnect' : 'Connect'}
      </button>
      
      <div>Status: {state}</div>
      
      {messages.map(msg => (
        <div key={msg.id}>
          <strong>{msg.role}: </strong>
          <span>{msg.content}</span>
          {msg.partial && <span style={{color: 'red'}}> (Interrupted)</span>}
        </div>
      ))}
    </div>
  );
}
```

## Vue 3 (`@voice-line/vue`)

The Vue wrapper uses Vue Composables to expose reactive state.

```vue
<script setup lang="ts">
import { useVoiceAgent } from '@voice-line/vue';

const {
  state,            // Ref<'idle' | 'connecting' | ...>
  messages,         // Ref<Message[]>
  isConnected,      // ComputedRef<boolean>
  isBotSpeaking,    // ComputedRef<boolean>
  connect,
  disconnect,
  toggleMic,
  sendText,
} = useVoiceAgent({
  serverUrl: 'ws://localhost:3001/api/voice',
  transport: 'ws',
});
</script>

<template>
  <div>
    <button @click="isConnected ? disconnect() : connect()">
      {{ isConnected ? 'Disconnect' : 'Connect' }}
    </button>
    
    <div>Status: {{ state }}</div>
    
    <div v-for="msg in messages" :key="msg.id">
      <strong>{{ msg.role }}: </strong>
      <span>{{ msg.content }}</span>
      <span v-if="msg.partial" style="color: red;"> (Interrupted)</span>
    </div>
  </div>
</template>
```

## Framework-Agnostic usage (`@voice-line/client`)

If you are using Vanilla JS, Svelte, Angular, or Solid, you can use the core client directly:

```typescript
import { VoiceLineClient } from '@voice-line/client';
import { createWsClientSession } from '@voice-line/transport-ws';

const client = new VoiceLineClient({
  serverUrl: 'ws://localhost:3000/api/voice',
  transportFactory: createWsClientSession,
});

// Subscribe to state changes
client.onStateChange((state) => {
  console.log('Session state:', state);
});

// Subscribe to messages
client.onMessageChange((messages) => {
  console.log('Chat history updated:', messages);
});

// Connect
await client.connect();
```
