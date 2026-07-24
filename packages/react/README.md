# @voice-line/react

React hooks for voice-line. Thin reactivity wrapper over `@voice-line/client`.

```tsx
import { useVoiceAgent } from '@voice-line/react'

const { state, messages, connect, sendText } = useVoiceAgent({
  transport, // Transport instance
})
```
