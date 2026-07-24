# @voice-line/provider-sarvam

Sarvam AI providers for voice-line:

- **STT** — Saaras v3 (WebSocket streaming + REST fallback)
- **TTS** — Bulbul v3 (HTTP stream + REST fallback)

Auth uses the `api-subscription-key` header (not Bearer). Set `SARVAM_API_KEY` or pass `apiKey`.

```ts
import { sarvam } from '@voice-line/provider-sarvam'

stt: sarvam.stt({ language: 'en-IN' })
tts: sarvam.tts({ voice: 'shubh' }) // bulbul:v3 default
```

Note: v2 voices (`anushka`, etc.) are not compatible with bulbul:v3.
