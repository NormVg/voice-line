import type { VoiceLineServerConfig } from "./config.js";
import { createServer } from "./server.js";

export interface CreateSessionResponse {
  sessionId: string;
}

/**
 * Next.js App Router route handler factory.
 *
 * ```ts
 * // app/api/voice/route.ts
 * export const POST = createRouteHandler({ transport, stt, tts, brain })
 * ```
 *
 * POST creates a session and returns `{ sessionId }`.
 * The transport is expected to already be configured so the client can join
 * the same session channel (e.g. Ably token + channel name).
 */
export function createRouteHandler(config: VoiceLineServerConfig) {
  const server = createServer(config);

  return async function POST(request: Request): Promise<Response> {
    try {
      const body = (await safeJson(request)) as { sessionId?: string } | null;
      const session = await server.createSession(body?.sessionId);
      const payload: CreateSessionResponse = { sessionId: session.id };
      return Response.json(payload, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      config.onError?.(err instanceof Error ? err : new Error(message));
      return Response.json({ error: message }, { status: 500 });
    }
  };
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export { createServer } from "./server.js";
export { dualBrain } from "./dual-brain.js";
export type { DualBrainOptions, HandoffDecision, HandoffFn, HandoffMode } from "./dual-brain.js";
export type { VoiceLineServerConfig } from "./config.js";
