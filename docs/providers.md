# Providers (STT & TTS)

Providers are pluggable implementations of Speech-to-Text (STT) and Text-to-Speech (TTS). Providers are entirely stateless factories — they know nothing about Sessions, Pipelines, or Transports.

## 1. Sarvam AI (`@voice-line/provider-sarvam`)

Sarvam AI provides state-of-the-art speech models tailored for Indian languages. `voice-line` ships with native support for Sarvam.

### Speech-to-Text (Saaras)

```typescript
import { sarvam } from '@voice-line/provider-sarvam';

const stt = sarvam.stt({
  apiKey: process.env.SARVAM_API_KEY,
  language: 'en-IN', // Options: 'hi-IN', 'ta-IN', 'bn-IN', etc.
});
```

The STT provider handles streaming audio to Sarvam's WebSocket APIs and emits `transcript:partial` and `transcript:final` events back to the session.

### Text-to-Speech (Bulbul)

```typescript
import { sarvam } from '@voice-line/provider-sarvam';

const tts = sarvam.tts({
  apiKey: process.env.SARVAM_API_KEY,
  voice: 'anushka', // Options: 'anushka', 'prateek', 'shreyas', etc.
  language: 'en-IN',
});
```

The TTS provider accepts completed sentences from the `SentenceChunker` and returns an asynchronous generator of raw PCM audio chunks.

## Building Custom Providers

You can build your own providers for services like Deepgram, Whisper, ElevenLabs, or OpenAI by implementing their respective interfaces.

### The `STTProvider` Interface

```typescript
interface STTProvider {
  createStream(config: STTConfig): STTStream
}

interface STTStream {
  write(chunk: ArrayBuffer): void
  on(event: 'transcript', handler: (result: TranscriptResult) => void): void
  on(event: 'error', handler: (error: Error) => void): void
  close(): Promise<void>
}

interface TranscriptResult {
  text: string
  isFinal: boolean
  language: string
  confidence: number
}
```

### The `TTSProvider` Interface

```typescript
interface TTSProvider {
  // Returns an AsyncIterable to stream audio as it generates
  synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk>
  
  // Instantly aborts generation (used during interruptions)
  abort(): void
}

interface AudioChunk {
  data: ArrayBuffer
  sampleRate: number
  format: 'pcm16' | 'opus'
}
```
