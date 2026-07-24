# Brain Adapters

In `voice-line`, the **Brain** is the intelligence behind the agent. `voice-line` calls your brain with transcribed text from the user, and expects text back. 

To bridge the gap between `voice-line` and popular LLM frameworks, we provide **Adapters**.

---

## Vercel AI SDK (`@voice-line/adapter-ai-sdk`)

The `fromAISDK` adapter wraps the Vercel AI SDK's powerful `streamText` function into an async generator that the voice pipeline can consume.

### Installation

```bash
npm install @voice-line/adapter-ai-sdk ai @ai-sdk/openai
```

### Basic Usage

```typescript
import { fromAISDK } from '@voice-line/adapter-ai-sdk'
import { openai } from '@ai-sdk/openai'

const brain = fromAISDK({
  model: openai('gpt-4o-mini'),
  system: 'You are a helpful voice assistant.',
})
```

### Multi-Agent Strategy (Fast / Heavy Handoff)

The biggest killer of voice UX is latency. A heavy LLM with tool calling takes 2-5 seconds to start generating text. In a voice conversation, 2 seconds of silence feels like an eternity.

By relying on the Vercel AI SDK, we can implement the "Fast Brain / Background Agent" pattern. 

1. **The Fast Brain** handles the immediate conversational layer and acknowledges the user instantly.
2. **The Background Tools** spawn async workers or call long-running sub-agents.

```typescript
import { fromAISDK } from '@voice-line/adapter-ai-sdk'
import { openai } from '@ai-sdk/openai'
import { tool } from 'ai'
import { z } from 'zod'

const brain = fromAISDK({
  model: openai('gpt-4o-mini'), // Fast response model
  system: 'You are a fast voice assistant. Use background tools for heavy tasks.',
  tools: {
    searchFlights: tool({
      description: 'Searches for flights in the background. Acknowledges instantly.',
      parameters: z.object({ destination: z.string() }),
      execute: async ({ destination }) => {
        // 1. Spawn the heavy background task asynchronously (do not await)
        runHeavyAgentTask(destination)
        
        // 2. Acknowledge immediately so the Fast Brain can speak
        return `I'm looking up flights to ${destination} right now...`
      }
    })
  }
})
```

---

## Eve (`@voice-line/adapter-eve`)

The `adapter-eve` package connects an Eve durable agent to `voice-line`. 

### Installation

```bash
npm install @voice-line/adapter-eve
```

### Usage

```typescript
import { fromEve } from '@voice-line/adapter-eve'

const brain = fromEve({
  agentId: 'support-agent',
  // Eve handles the LLM, memory, tools, skills, and durable workflows internally.
  // voice-line only sees text in → text out.
})
```

---

## Building a Custom Brain

If you don't want to use an adapter, you can just write a raw function. The `Brain` type in `@voice-line/core` is defined as:

```typescript
type Brain = (
  userText: string,
  context: BrainContext
) => Promise<string> | AsyncGenerator<string>
```

For the best UX, you should **always return an AsyncGenerator** so the TTS can begin synthesizing the first sentence before the LLM has finished generating the entire response.

```typescript
const customBrain = async function* (userText: string, context: BrainContext) {
  // context.history contains the full conversation history
  const stream = await callMyCustomLLM(context.history, userText)
  
  for await (const chunk of stream) {
    yield chunk
  }
}
```
