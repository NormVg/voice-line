# @voice-line/transport-ably

Ably realtime transport for voice-line.

```ts
import { ably } from '@voice-line/transport-ably'

// Server
transport: ably({ apiKey: process.env.ABLY_API_KEY })

// Client
transport: ably({ authUrl: '/api/ably-token' })
```

Peer dependency: `ably` ^2.
