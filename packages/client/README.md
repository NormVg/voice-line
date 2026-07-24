# @voice-line/client

Framework-agnostic browser runtime for voice-line.

- `VoiceLineClient` — connect, mic, speaker, messages, events
- `Microphone` — MediaStream → PCM16 chunks
- `Speaker` — queued Web Audio playback with flush on interrupt

Vue and React packages wrap this client; they add reactivity only.
