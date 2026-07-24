import type { VoiceLineServerConfig } from "./config.js";
import { createServer } from "./server.js";
import { createTTSHandlerBase, type TTSHandlerConfig } from "./tts-handler.js";
import { createStatelessHandlerBase, type StatelessHandlerConfig } from "./stateless.js";

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

/**
 * Next.js App Router API handler for a standalone TTS endpoint.
 */
export function createTTSHandler(config: TTSHandlerConfig) {
  const base = createTTSHandlerBase(config);
  return async function POST(request: Request): Promise<Response> {
    try {
      const body = (await safeJson(request)) as { text?: string } | null;
      if (!body?.text) {
        return Response.json({ error: "Missing 'text' in request body" }, { status: 400 });
      }

      const stream = await base(body.text);

      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              controller.enqueue(new Uint8Array(chunk.data));
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });

      return new Response(readable, {
        headers: { "Content-Type": "audio/pcm" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500 });
    }
  };
}

/**
 * Next.js App Router API handler for a stateless Push-to-Talk endpoint.
 */
export function createStatelessHandler(config: StatelessHandlerConfig) {
  const base = createStatelessHandlerBase(config);
  return async function POST(request: Request): Promise<Response> {
    try {
      const arrayBuffer = await request.arrayBuffer();
      if (!arrayBuffer.byteLength) {
        return Response.json({ error: "Empty request body" }, { status: 400 });
      }

      const stream = base(arrayBuffer);

      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              controller.enqueue(new Uint8Array(chunk));
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });

      return new Response(readable, {
        headers: { "Content-Type": "audio/pcm" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500 });
    }
  };
}

export { createServer } from "./server.js";
export type { VoiceLineServerConfig } from "./config.js";
