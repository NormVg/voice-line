# @voice-line/vue

Vue 3 composables for voice-line. Thin reactivity wrapper over `@voice-line/client`.

```ts
import { useVoiceAgent } from '@voice-line/vue'

const { state, messages, connect, sendText } = useVoiceAgent({
  transport, // Transport instance
})
```
