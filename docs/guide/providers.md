# Providers

A **Provider** is a pluggable implementation of Speech-to-Text (STT) or Text-to-Speech (TTS). Providers are stateless factories—they just create streams or synthesize audio based on the input they receive.

---

## Sarvam AI (`@voice-line/provider-sarvam`)

Sarvam AI provides state-of-the-art voice models tailored for Indian languages.
- **Saaras**: Speech-to-Text
- **Bulbul**: Text-to-Speech

### Installation

```bash
npm install @voice-line/provider-sarvam
```

### Configuration

Ensure you have your `SARVAM_API_KEY` set in your environment variables. The provider will automatically pick it up, or you can pass it explicitly.

```typescript
import { sarvam } from '@voice-line/provider-sarvam'

const sttProvider = sarvam.stt({
  language: 'hi-IN',     // e.g., 'en-IN', 'hi-IN', 'ta-IN'
  apiKey: 'YOUR_API_KEY' // Optional if process.env.SARVAM_API_KEY is set
})

const ttsProvider = sarvam.tts({
  voice: 'anushka',      // or 'shubh'
  apiKey: 'YOUR_API_KEY'
})
```

---

## Building a Custom Provider

You can easily build your own provider by implementing the `STTProvider` or `TTSProvider` interfaces from `@voice-line/core`.

### Custom TTS Example

```typescript
import type { TTSProvider, TTSConfig, AudioChunk } from '@voice-line/core'

export function myCustomTTS(): TTSProvider {
  return {
    async *synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk> {
      // 1. Call your custom TTS API
      const response = await fetch('https://my-tts-api.com', {
        method: 'POST',
        body: JSON.stringify({ text })
      })

      // 2. Yield audio chunks back to the pipeline
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        yield {
          data: value.buffer,
          sampleRate: 16000,
          format: 'pcm16'
        }
      }
    },
    abort() {
      // Optional cleanup logic when the user interrupts the agent
    }
  }
}
```
