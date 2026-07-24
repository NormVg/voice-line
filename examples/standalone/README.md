# standalone example

Minimal voice-line stack over raw WebSockets — no Ably, no Sarvam, no LLM.

## Run

From the monorepo root (after `pnpm install && pnpm build`):

```bash
# terminal 1 — server
pnpm --filter @voice-line/example-standalone start

# terminal 2 — CLI client
pnpm --filter @voice-line/example-standalone client -- "book me a flight"
```

Server listens on `ws://127.0.0.1:3001`.

## What it proves

1. Client connects with `WsTransport`
2. Server wraps the socket with `fromWebSocket` and starts a `Session`
3. `client:ready` → `session:ready` → `listening`
4. `text:send` runs brain → sentence chunker → mock TTS → binary audio back
