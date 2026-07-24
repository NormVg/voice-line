# Frontend Integration

`voice-line` provides Vue and React adapters that abstract away token fetching, WebSocket connection management, and audio capture/playback.

Both `@voice-line/vue` and `@voice-line/react` expose the exact same API surface, only the underlying reactivity mechanism differs.

---

## React (`@voice-line/react`)

```bash
npm install @voice-line/react
```

### Basic Hook Usage

```tsx
import { useVoiceAgent } from '@voice-line/react'
import { createAblyClientSession } from '@voice-line/transport-ably'
import Ably from 'ably'

function VoiceChat() {
  const {
    state,
    messages,
    isConnected,
    isBotSpeaking,
    connect,
    disconnect,
    toggleMic,
    sendText
  } = useVoiceAgent({
    session: createAblyClientSession('/api/session', Ably.Realtime)
  })

  return (
    <div>
      <p>Status: {state}</p>
      
      {!isConnected ? (
        <button onClick={connect}>Start Chat</button>
      ) : (
        <>
          <button onClick={toggleMic}>Toggle Mic</button>
          <button onClick={disconnect}>End Chat</button>
        </>
      )}

      {/* Render the unified transcript history */}
      <div className="transcript">
        {messages.map(msg => (
          <div key={msg.id} className={msg.role}>
            {msg.content}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## Vue (`@voice-line/vue`)

```bash
npm install @voice-line/vue
```

### Basic Composable Usage

```vue
<script setup lang="ts">
import { useVoiceAgent } from '@voice-line/vue'

const {
  state,
  messages,
  isConnected,
  connect,
  disconnect,
  toggleMic
} = useVoiceAgent({
  serverUrl: 'ws://localhost:3000/_ws',
  transport: 'ws'
})
</script>

<template>
  <div>
    <p>Status: {{ state }}</p>
    
    <div v-if="!isConnected">
      <button @click="connect">Connect</button>
    </div>
    
    <div v-else>
      <button @click="toggleMic">Mic</button>
      <button @click="disconnect">Disconnect</button>
    </div>
  </div>
</template>
```

---

## State Machine

The `state` property exposed by the hook follows a strict progression:

| State | Description |
|---|---|
| `idle` | Disconnected or ready to connect. |
| `connecting` | Fetching tokens, connecting to the transport, opening the microphone. |
| `listening` | Connected and waiting for user speech. |
| `receiving` | VAD has detected speech and is streaming audio to STT. |
| `processing` | User has finished speaking; waiting for the Brain (LLM) to generate a response. |
| `speaking` | The agent is synthesizing and playing audio through the speaker. |

### Interruption State Transitions
If the state is `speaking` and the user interrupts by talking, the state will instantly jump back to `receiving`. The `audio:flush` event is fired internally, halting the audio playback.

## Unified Messaging

The `messages` array contains the full conversation history. `voice-line` keeps the text transcript and the voice conversation perfectly in sync.

If you want the user to be able to type a message instead of speaking it (useful for loud environments), simply call the `sendText(text)` function. This bypasses the STT step and immediately triggers the `processing` state for the LLM.
