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
export function createRouteHandler(
  configOrFactory: VoiceLineServerConfig | ((request: Request) => Promise<VoiceLineServerConfig> | VoiceLineServerConfig)
) {
  const staticServer = typeof configOrFactory === "function" ? null : createServer(configOrFactory);

  return async function POST(request: Request): Promise<Response> {
    let currentConfig: VoiceLineServerConfig | undefined;
    try {
      if (typeof configOrFactory === "function") {
        currentConfig = await configOrFactory(request);
      } else {
        currentConfig = configOrFactory;
      }
      const server = staticServer ?? createServer(currentConfig);

      const body = (await safeJson(request)) as { sessionId?: string } | null;
      const { session, clientPayload } = await server.createSession(body?.sessionId);
      
      const payload: CreateSessionResponse & Record<string, unknown> = { 
        sessionId: session.id,
        ...clientPayload
      };
      
      return Response.json(payload, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      currentConfig?.onError?.(err instanceof Error ? err : new Error(message));
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

/**
 * Creates a zero-boilerplate WebSocket handler for Next.js (`next-ws`).
 * 
 * @param configFactory A function returning your VoiceLineServerConfig. It receives the standard `ws` client and `req`.
 * @returns An `UPGRADE` function expected by `next-ws`.
 */
export function createNextWebSocketHandler(
  configFactory: (client: any, req: any) => VoiceLineServerConfig | Promise<VoiceLineServerConfig>
) {
  return async function UPGRADE(client: any, req: any) {
    try {
      const config = await configFactory(client, req);
      const server = createServer(config);
      
      const host = req.headers.host || "localhost";
      const url = new URL(req.url, `http://${host}`);
      const sessionId = url.searchParams.get("session");
      
      // For raw WebSockets, the config's transport property is already the connected socket!
      // `createServer.createSession` will call `session.start()`, which waits for transport connect.
      // `WsTransport.connect` resolves instantly since the socket is already open.
      const { session } = await server.createSession(sessionId ?? undefined);
      
      // When the socket closes, close the session
      client.on("close", () => {
        void session.close().catch((err: unknown) => {
          console.error("[voice-line] session close failed:", err);
        });
      });
      
    } catch (err) {
      console.error("[voice-line] Failed to start Next WS session:", err);
      client.close();
    }
  };
}

