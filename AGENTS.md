# voice-line

Real-time voice layer for AI agents. TypeScript monorepo. No WebRTC — WebSockets only.

The full spec lives in [project.md](./project.md). Read it before any non-trivial change. This file is the operating manual on top of that spec.

---

## Golden Rules

1. **Respect the domain model.** Every package maps to exactly one of: Session, Transport, Pipeline, Brain, Provider. If a change blurs that boundary, stop and redesign — don't merge concerns.
2. **No patchwork.** Fix the root cause, not the symptom. If a bug reveals a bad interface, change the interface. If two places diverge, unify them. Never paper over with flags, special cases, or "just this once" branches.
3. **Interfaces are the contract.** Server depends on `Transport`, `STTProvider`, `TTSProvider`, `Brain` — never on their concrete packages. If you find a concrete import in `server/`, it is a bug.
4. **Leaf packages stay leaf.** Providers and adapters depend only on `@voice-line/core`. They must not import from `server`, `client`, or each other.
5. **No hidden state.** Sessions own their state machine. Pipelines are synchronous chains. Don't introduce event buses, DI containers, or global registries.
6. **Streaming is the default.** Any text/audio path that could be a stream should be a stream. Batching kills voice UX.

---

## Repository Layout

```
voice-line/
├── packages/
│   ├── core/                 # Domain: types, interfaces, Pipeline, Session, VAD, chunker
│   ├── server/               # Server runtime, session manager, dualBrain orchestrator
│   ├── client/               # Browser runtime: mic, speaker, event dispatch
│   ├── vue/                  # Vue 3 composables — wraps client
│   ├── react/                # React hooks — wraps client
│   ├── transport-ably/       # Transport impl
│   ├── transport-ws/         # Transport impl
│   ├── provider-sarvam/      # STT + TTS impl
│   ├── provider-deepgram/    # STT impl
│   ├── provider-elevenlabs/  # TTS impl
│   ├── adapter-ai-sdk/       # Brain adapter — Vercel AI SDK
│   └── adapter-eve/          # Brain adapter — Eve
├── examples/                 # Runnable demo apps (see project.md § Roadmap)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

Naming: `@voice-line/<name>` matches the folder. Public entry is `src/index.ts` per package.

### Dependency direction (enforced)

```
core  ←  server, client, transport-*, provider-*, adapter-*
client ← vue, react
```

- `core` imports nothing from the workspace.
- `server` may import `core` and interface types only. No `transport-ably` or `provider-sarvam` imports.
- Leaf packages (`transport-*`, `provider-*`, `adapter-*`) import `core` only.
- `vue`/`react` wrap `client`. They add reactivity — nothing else.

If a change needs a new cross-package edge, that's a design discussion, not a shortcut.

---

## Package Conventions

Each package has this shape:

```
packages/<name>/
├── src/
│   ├── index.ts       # Public exports only. Nothing else re-exported.
│   └── ...            # Internal modules
├── test/              # Vitest specs colocated by feature
├── package.json
├── tsconfig.json      # extends ../../tsconfig.base.json
└── README.md          # One-paragraph purpose + minimal example
```

- **Public surface is `src/index.ts`.** If it's not exported there, consumers can't use it. Keep the surface small.
- **No circular imports.** ESM only.
- **No default exports.** Named only.
- **Types over classes** unless a class earns its keep (Session, Pipeline, VoiceLineClient are the current exceptions).

---

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Module: `ESNext`, target: `ES2022`, `moduleResolution: bundler`.
- No `any`. Use `unknown` at boundaries and narrow. If you truly need an escape hatch, add a comment explaining why.
- Prefer discriminated unions over enums.
- Public interfaces from `core` are the source of truth — never redeclare them locally.

---

## Testing

- **Vitest** for unit tests, colocated per package.
- Test the **interface**, not the implementation. A provider test should target `STTProvider`; a transport test should target `Transport`.
- **No mocking of `core`.** If you find yourself mocking Session or Pipeline, you're testing the wrong seam.
- Audio fixtures live in `test/fixtures/` per package that needs them.
- Integration tests for full sessions live in `examples/*/test/`.

Run: `pnpm -r test` from the root. Per-package: `pnpm --filter @voice-line/core test`.

---

## Tooling

- **Package manager:** pnpm (workspaces). Never mix in npm/yarn.
- **Build:** `tsup` per package, producing ESM only.
- **Lint/format:** Biome. Config at the root.
- **Node:** >=20.
- **Changesets** for versioning and releases.

---

## What Belongs Where

| If you're adding... | It goes in... |
|---|---|
| A new STT or TTS service | `packages/provider-<name>/` |
| A new transport (WebRTC, SSE, etc.) | `packages/transport-<name>/` |
| A new LLM framework brain | `packages/adapter-<name>/` |
| A new pipeline processor (echo cancel, resample) | `packages/core/src/pipeline/` |
| A new session-level orchestrator (like dualBrain) | `packages/server/src/` |
| Framework bindings (Svelte, Solid, etc.) | `packages/<framework>/` wrapping `client` |

If it doesn't fit, the design is wrong — surface the mismatch before writing code.

---

## Anti-Patterns (Do Not Do)

- Importing a provider directly in `server/` instead of accepting an `STTProvider`.
- Adding a `type: 'sarvam' | 'deepgram'` field to `core` types.
- Reaching into another package's `src/` bypassing `index.ts`.
- Adding a config flag to preserve old behavior. Change the behavior and update callers.
- Wrapping a stream in a promise "for simplicity."
- Emitting audio and JSON on the same channel.
- Silent catches. Errors go through the pipeline error path or `onError`.
- Introducing a new abstraction when one of the five domain concepts fits.

---

## Skills to Use

When working in this repo, prefer these skills (invoke via the Skill tool):

- **`voice-agents`** — Sarvam STT/TTS, LiveKit/Pipecat patterns. Any change touching `provider-sarvam` or the outbound/inbound pipelines.
- **`speech-to-text` / `text-to-speech`** — Sarvam Saaras (STT) and Bulbul v3 (TTS) API details.
- **`ai-sdk`** — When touching `adapter-ai-sdk`.
- **`eve`** — When touching `adapter-eve`.
- **`ably`** — When touching `transport-ably`.
- **`websockets`** — When touching `transport-ws` or the client's event/audio channels.
- **`nuxt`** — For the `examples/nuxt-app/` and the Nitro server integration.
- **`vibe-coding`** — Keep iterations small and verified. Read before starting multi-step work.
- **`simplify`** — Run over changed code before considering a package "done."

---

## Commit & PR Discipline

- One package per commit where possible. Cross-package commits should have a clear reason in the message.
- Commit messages: imperative mood, subject explains the *why*.
- Every PR that changes a public interface needs a Changeset entry.
- Update `project.md` when the architecture changes. `project.md` is the spec — it must not drift from the code.

---

## When In Doubt

1. Re-read `project.md`.
2. Ask which of the five domain concepts your change belongs to.
3. If the answer is "a new one," pause and discuss before coding.
