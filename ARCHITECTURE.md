# voice-line

## Navigation

```mermaid
graph LR
    SO[System Overview] --> CD[Core Pipeline]
    SO --> CLI[Client Architecture]
    SO --> SRV[Server Architecture]
    CD --> SD[Turn Sequence]
```

<!-- diagram:overview:system -->
## System Overview

```mermaid
graph TD
    subgraph Browser
        Vue[Vue / React Hooks]
        Client[Client SDK]
        Mic((Mic))
        Speaker((Speaker))
    end
    
    subgraph Transports
        WS[WebSocket Transport]
        Ably[Ably Transport]
    end
    
    subgraph Node Server
        SessionManager[Session Manager]
        Core[Core Session & Pipeline]
    end
    
    subgraph Brain
        AISDK[Vercel AI SDK Adapter]
        LLM([LLM Provider])
    end
    
    subgraph AI Providers
        SarvamSTT([Sarvam STT])
        SarvamTTS([Sarvam TTS])
    end
    
    Vue --> Client
    Mic --> Client
    Client --> Speaker
    Client <--> WS
    Client <--> Ably
    WS <--> SessionManager
    Ably <--> SessionManager
    SessionManager --> Core
    Core --> SarvamSTT
    Core --> AISDK
    AISDK --> LLM
    Core --> SarvamTTS
```

<!-- diagram:component:core -->
## Core Pipeline

```mermaid
graph TD
    subgraph Inbound
        AudioIn((Audio Frames))
        VAD[VAD Processor]
        STT[STT Processor]
    end
    
    subgraph Session
        SM[Session State Machine]
        History[Message History]
    end
    
    subgraph Outbound
        Brain[Brain Interface]
        Chunker[Sentence Chunker]
        TTS[TTS Generator]
    end
    
    AudioIn --> VAD
    VAD -->|speech_start / audio| STT
    STT -->|transcript:final| SM
    SM --> History
    SM -->|user text| Brain
    Brain -->|token stream| Chunker
    Chunker -->|sentence frames| TTS
    TTS -->|audio chunks| Session
```

<!-- diagram:component:client -->
## Client Architecture

```mermaid
graph TD
    subgraph UI Bindings
        Vue[vue/useVoiceAgent]
        React[react/useVoiceAgent]
    end
    
    subgraph Client SDK
        VLC[VoiceLineClient]
        Dispatcher[EventDispatcher]
    end
    
    subgraph Audio
        Mic[Microphone ScriptProcessor]
        Spk[Speaker AudioWorklet]
    end
    
    Vue --> VLC
    React --> VLC
    VLC --> Mic
    VLC --> Spk
    VLC --> Dispatcher
    Mic -->|PCM16 chunks| VLC
```

<!-- diagram:sequence:turn -->
## Turn Sequence

```mermaid
sequenceDiagram
    participant User
    participant Mic as Client Mic
    participant STT as Sarvam STT
    participant Ses as Core Session
    participant LLM as AI SDK Brain
    participant TTS as Sarvam TTS
    participant Spk as Client Speaker
    
    User->>Mic: Speaks
    Mic->>Ses: WS Audio Frames
    Ses->>STT: STTStream write
    STT-->>Ses: transcript:partial
    STT-->>Ses: transcript:final
    Ses->>LLM: runBrainTurn(text)
    LLM-->>Ses: Token Stream
    Ses->>TTS: enqueueSentence(text)
    TTS-->>Ses: AudioChunk Stream
    Ses->>Spk: WS Audio Frames
    Spk->>User: Audio Playback
```
