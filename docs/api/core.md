# API Reference: `@voice-line/core`

The `@voice-line/core` package defines the domain model and all fundamental interfaces.

## Interfaces

### `Transport`

```typescript
export interface Transport {
  connect(sessionId: string): Promise<void>
  disconnect(): Promise<void>

  sendAudio(chunk: ArrayBuffer): void
  onAudio(handler: (chunk: ArrayBuffer) => void): Unsubscribe

  sendEvent(event: VoiceLineEvent): void
  onEvent(handler: (event: VoiceLineEvent) => void): Unsubscribe

  readonly state: 'idle' | 'connecting' | 'connected' | 'disconnected'
}
```

### `STTProvider`

```typescript
export interface STTProvider {
  createStream(config: STTConfig): STTStream
}

export interface STTStream {
  write(chunk: ArrayBuffer): void
  on(event: 'transcript', handler: (result: TranscriptResult) => void): void
  on(event: 'error', handler: (error: Error) => void): void
  close(): Promise<void>
}
```

### `TTSProvider`

```typescript
export interface TTSProvider {
  synthesize(text: string, config: TTSConfig): AsyncIterable<AudioChunk>
  abort(): void
}
```

### `Brain`

```typescript
export type Brain = (
  userText: string,
  context: BrainContext
) => Promise<string> | AsyncGenerator<string>

export interface BrainContext {
  sessionId: string
  history: Message[]
  interrupt: () => void
  metadata: Record<string, unknown>
}
```

### `VoiceLineServerConfig`

```typescript
export interface VoiceLineServerConfig {
  transport: 
    | Transport 
    | ((sessionId: string) => 
        | Transport 
        | Promise<Transport> 
        | { transport: Transport; clientPayload?: Record<string, unknown> }
        | Promise<{ transport: Transport; clientPayload?: Record<string, unknown> }>
      );
  stt: STTProvider;
  tts: TTSProvider;
  brain: Brain;

  audio?: Partial<AudioConfig>;
  sttConfig?: STTConfig;
  ttsConfig?: TTSConfig;
  vad?: Partial<VADConfig>;
  chunker?: Partial<ChunkerConfig>;
  session?: Partial<SessionConfig>;

  onSessionStart?: (session: Session) => void;
  onSessionEnd?: (session: Session) => void;
  onError?: (error: Error, session?: Session) => void;
}
```
