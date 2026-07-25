# The Brain & Multi-Agent Architecture

voice-line relies on a simple abstraction called the `Brain` to generate responses. The Brain is nothing but a function that takes transcribed text and returns text.

## The `Brain` Interface

```typescript
type Brain = (
  userText: string,
  context: BrainContext
) => Promise<string> | AsyncGenerator<string>

interface BrainContext {
  sessionId: string
  history: Message[]
  interrupt: () => void
  metadata: Record<string, unknown>
}
```

While you can return a simple `Promise<string>`, we strongly recommend returning an `AsyncGenerator<string>` so that tokens are streamed. Streaming ensures that TTS can begin synthesizing the first sentence while the LLM is still generating the rest of the response.

## Vercel AI SDK Adapter (`@voice-line/adapter-ai-sdk`)

Instead of building proprietary orchestration layers, voice-line integrates natively with the Vercel AI SDK.

```typescript
import { fromAISDK } from '@voice-line/adapter-ai-sdk';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const myBrain = fromAISDK({
  model: openai('gpt-4o'),
  system: 'You are a helpful voice assistant.',
  tools: {
    getWeather: {
      description: 'Get current weather',
      parameters: z.object({ city: z.string() }),
      execute: async ({ city }) => fetchWeather(city),
    },
  },
});
```

`fromAISDK` automatically wraps the Vercel AI SDK's `streamText()` into an `AsyncGenerator` that the voice-line pipeline can consume.

## Eve Framework Adapter (`@voice-line/adapter-eve`)

You can also use durable, stateful agents built on the Eve framework.

```typescript
import { fromEve } from '@voice-line/adapter-eve';

const myEveBrain = fromEve({
  agentId: 'support-agent',
});
```
Eve handles the LLM, memory, skills, and workflows internally. voice-line just pipes the voice input/output to it.

## Multi-Agent Strategies (Combating Latency)

The biggest killer of voice UX is latency. A heavy LLM with tool calling can take 2-5 seconds to generate its first token. In a voice conversation, 3 seconds of silence feels like an eternity.

We recommend the **"Fast / Background" agent strategy**:

1. **The Fast Brain** (e.g., `gpt-4o-mini` or `Llama-3-8B`) handles the immediate conversational layer. It acknowledges the user instantly.
2. **The Background Tools** spawn async workers or call long-running sub-agents without blocking the main stream.
3. **The Handoff**: Once the background tool completes, it pushes an event to the client or injects context into the conversation history, prompting the Fast Brain to summarize the result.

### Example

```typescript
import { fromAISDK } from '@voice-line/adapter-ai-sdk';
import { tool } from 'ai';
import { z } from 'zod';

const fastBrain = fromAISDK({
  model: openai('gpt-4o-mini'), 
  system: 'You are a fast voice assistant. Use background tools for heavy tasks.',
  tools: {
    searchFlights: tool({
      description: 'Searches for flights in the background. Acknowledges instantly.',
      parameters: z.object({ destination: z.string() }),
      execute: async ({ destination }) => {
        // 1. Acknowledge immediately so the Fast Brain can speak
        
        // 2. Spawn the heavy background task (sub-agent) asynchronously
        runHeavyAgentTask(destination).then(result => {
           // Push an event to the client or update the session history here
        });

        return `I'm looking up flights to ${destination} right now...`;
      }
    })
  }
});
```
