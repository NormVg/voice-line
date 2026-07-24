# @voice-line/adapter-ai-sdk

Turns Vercel AI SDK `streamText()` into a voice-line `Brain`.

```ts
import { fromAISDK } from '@voice-line/adapter-ai-sdk'
import { openai } from '@ai-sdk/openai'

brain: fromAISDK({
  model: openai('gpt-4o'),
  system: 'You are a helpful voice assistant. Keep responses concise.',
})
```

Peer dependency: `ai` ^4 or ^5.
