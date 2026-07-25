# Architecture & Core Concepts

voice-line is engineered around strict domain boundaries. We do not mix transport logic with audio logic, nor do we mix AI logic with state machines. 

## The Domain Model

Every part of voice-line maps to exactly one of five core abstractions:

```
┌─────────────────────────────────────────────────────────────────┐
│                          Session                                │
│                                                                 │
│  A single voice conversation between one user and one agent.    │
│  Owns the lifecycle, message history, and state machine.        │
│                                                                 │
│  ┌───────────┐   ┌───────────┐   ┌──────┐   ┌───────────────┐ │
│  │ Transport │──►│  Pipeline  │──►│ Brain│──►│   Pipeline    │ │
│  │           │   │  (Inbound) │   │      │   │  (Outbound)   │ │
│  │ Ably / WS │   │  VAD → STT │   │ You  │   │  TTS → Audio  │ │
│  │           │◄──│            │   │      │◄──│               │ │
│  └───────────┘   └───────────┘   └──────┘   └───────────────┘ │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     Providers                             │  │
│  │  STT: Sarvam, Deepgram, Whisper                          │  │
│  │  TTS: Sarvam, ElevenLabs, OpenAI                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1. Session
A `Session` represents a single voice conversation. It is created when a user connects and destroyed when they disconnect. It orchestrates the pipelines and manages the interruption state machine.

### 2. Transport
Moves binary audio chunks and JSON events between the client and server. Transports know nothing about audio formats or AI; their only job is to `send` and `receive`. 

### 3. Pipeline
A synchronous chain of processors. There are two pipelines per session:
- **Inbound:** Raw audio → VAD (Voice Activity Detection) → STT (Speech-to-Text).
- **Outbound:** Text tokens → Sentence chunker → TTS (Text-to-Speech) → Audio queue.

### 4. Brain
Your LLM logic. voice-line calls your Brain with transcribed text and expects text back (preferably via an async generator for streaming). 

### 5. Provider
Pluggable implementations of Speech-to-Text (STT) or Text-to-Speech (TTS). Providers are stateless factories.

---

## The Session State Machine

Every session follows this exact lifecycle. The strictness of this state machine is what prevents race conditions during interruptions.

```
  ┌──────┐    connect()    ┌────────────┐
  │ Idle │ ──────────────► │ Connected  │
  └──────┘                 └─────┬──────┘
                                 │
                          client-ready
                                 │
                                 ▼
                           ┌───────────┐
                      ┌───►│ Listening  │◄──────────────┐
                      │    └─────┬─────┘                │
                      │          │                      │
                      │    VAD: speech start             │
                      │          │                      │
                      │          ▼                      │
                      │    ┌───────────┐                │
                      │    │ Receiving │                │
                      │    └─────┬─────┘                │
                      │          │                      │
                      │    VAD: speech end               │
                      │          │                      │
                      │          ▼                      │
                      │    ┌───────────┐                │
                      │    │Processing │  STT → Brain   │
                      │    └─────┬─────┘                │
                      │          │                      │
                      │    brain responds               │
                      │          │                      │
                      │          ▼                      │
                      │    ┌───────────┐                │
                      │    │ Speaking  │ TTS → Audio    │
                      │    └─────┬─────┘                │
                      │          │                      │
                      │    audio finished ───────────────┘
                      │          │
                      │    interrupt (user speaks) ─────┘
                      │
              disconnect()
                      │
                      ▼
                 ┌──────────┐
                 │  Closed  │
                 └──────────┘
```

### How Interruption Works

When the agent is in the `Speaking` state and the user starts talking (detected by the VAD on the inbound pipeline):

1. The Session transitions back to `Receiving`.
2. The Outbound pipeline is instantly flushed — TTS generation is aborted, and queued audio is discarded.
3. The Brain's async generator is cancelled (if it was still streaming tokens).
4. The partial assistant message is saved to history with the `partial: true` flag.
5. The Client receives an `audio:flush` event and stops playback immediately.
6. The Inbound pipeline begins processing the new user utterance.

This entire sequence happens synchronously on the server in a single tick.

---

## Pipeline Internals

### Why Sentence Chunking Matters
In the Outbound pipeline, your Brain streams text tokens (e.g., `"Sure"`, `"!"`, `" Let"`, `" me"`). If we sent each individual token to the TTS provider, the resulting audio would be robotic, disjointed, and extremely API-heavy.

The `SentenceChunker` buffers these tokens until it hits a sentence boundary (punctuation or newline). It then flushes a complete sentence to the TTS provider. This results in **highly natural prosody** while still maintaining low streaming latency.
