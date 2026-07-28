import type { VoiceLineServerConfig } from "./config.js";
import { DEFAULT_MAX_SESSIONS } from "./config.js";
import { createServer } from "./server.js";
import { createTTSHandlerBase, type TTSHandlerConfig } from "./tts-handler.js";
import { createStatelessHandlerBase, type StatelessHandlerConfig } from "./stateless.js";

/**
 * Process-wide live sessions for Nitro WS peers.
 * createNitroWebSocketHandler builds a server per peer (transport is socket-bound),
 * so SessionManager.maxSessions alone cannot cap peers — this Set does.
 */
const nitroLiveSessions = new Set<string>();

/**
 * Process-wide live sessions for HTTP createEventHandler (Ably / token path).
 * Factory configs create a new SessionManager per request; this Set enforces
 * maxSessions across the process.
 */
const httpLiveSessions = new Set<string>();

/**
 * Nuxt / Nitro event handler factory.
 *
 * ```ts
 * // server/api/voice.post.ts
 * export default createEventHandler({ transport, stt, tts, brain })
 * ```
 *
 * Compatible with h3's event handler signature without importing h3
 * (duck-typed to avoid a hard dependency).
 */
export function createEventHandler(
  configOrFactory: VoiceLineServerConfig | ((event: any) => Promise<VoiceLineServerConfig> | VoiceLineServerConfig)
) {
  // If static config, create the server once globally (true multi-session manager).
  const staticServer = typeof configOrFactory === "function" ? null : createServer(configOrFactory);

  return async (event: any) => {
    let currentConfig: VoiceLineServerConfig;
    if (typeof configOrFactory === "function") {
      currentConfig = await configOrFactory(event);
    } else {
      currentConfig = configOrFactory;
    }

    const maxSessions = currentConfig.maxSessions ?? DEFAULT_MAX_SESSIONS;
    // Factory path creates a new SessionManager per request — enforce capacity
    // process-wide. Static config uses SessionManager.maxSessions directly.
    const useGlobalCap = !staticServer && maxSessions > 0;

    if (useGlobalCap && httpLiveSessions.size >= maxSessions) {
      const err = new Error(
        `Session limit reached (${maxSessions}). Try again later.`,
      );
      (err as Error & { code?: string }).code = "ERR_CAPACITY";
      currentConfig.onError?.(err);
      throw err;
    }

    const server =
      staticServer ??
      createServer({
        ...currentConfig,
        // One session per throwaway manager; global Set is the real cap.
        maxSessions: maxSessions > 0 ? 1 : 0,
      });

    try {
      const body = event.context?.body ?? null;
      const { session, clientPayload } = await server.createSession(body?.sessionId);

      if (useGlobalCap) {
        httpLiveSessions.add(session.id);
        session.onStateChange((state) => {
          if (state === "closed") httpLiveSessions.delete(session.id);
        });
      }

      return { sessionId: session.id, ...clientPayload };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      currentConfig?.onError?.(err instanceof Error ? err : new Error(message));
      throw err;
    }
  };
}

/**
 * Nitro API handler for a standalone TTS endpoint.
 */
export function createTTSHandler(config: TTSHandlerConfig) {
  const base = createTTSHandlerBase(config);
  return async (event: any) => {
    // h3 readBody duck-typing
    let text = "";
    if (event.context?.body?.text) text = event.context.body.text;
    else if (event.node?.req) {
      // In a real Nuxt app, the user would use readBody(event) in their route file
      // and pass the text, or we can just expect { text: string } in the body
      throw new Error(
        "createTTSHandler must receive a parsed body with { text: string } via context, or you can wrap it to pass text directly.",
      );
    }

    if (!text) throw new Error("Missing 'text' in request body");

    const stream = await base(text);

    // Convert AsyncIterable<AudioChunk> to a web stream
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

    // In h3, you can just return the stream and it will chunk it.
    // However, it's safer to return a proper Response object in modern Nitro.
    return new Response(readable, {
      headers: {
        "Content-Type": "audio/pcm",
      },
    });
  };
}

/**
 * Nitro API handler for a stateless Push-to-Talk endpoint.
 */
export function createStatelessHandler(config: StatelessHandlerConfig) {
  const base = createStatelessHandlerBase(config);
  return async (event: any) => {
    // Assume raw body is an audio buffer.
    // In Nuxt, readRawBody(event) gets the buffer. We'll duck-type or expect context.rawBody.
    let audio: ArrayBuffer;
    if (event.context?.rawBody instanceof ArrayBuffer) {
      audio = event.context.rawBody;
    } else if (event.context?.rawBody instanceof Buffer) {
      const b = event.context.rawBody;
      audio = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    } else {
      throw new Error(
        "createStatelessHandler requires raw binary body. Use readRawBody() in Nuxt and pass to event.context.rawBody.",
      );
    }

    const stream = base(audio);

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
      headers: {
        "Content-Type": "audio/pcm",
      },
    });
  };
}

export { createServer } from "./server.js";
export type { VoiceLineServerConfig } from "./config.js";

/**
 * Polyfills a Nuxt Nitro WebSocket `peer` into a standard Node `ws`-like interface.
 * Use this when passing a Nitro peer to `fromWebSocket()`.
 */
export function nitroToWs(peer: any, listeners: Record<string, Function[]>): any {
  return {
    readyState: 1, // WS_OPEN
    send: (data: any) => peer.send(data),
    close: () => peer.close(),
    on: (event: string, listener: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(listener);
    },
    off: (event: string, listener: Function) => {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((l) => l !== listener);
    },
    addEventListener: (type: string, listener: any) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: any) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
  };
}

/**
 * Creates a zero-boilerplate WebSocket handler for Nuxt Nitro.
 * 
 * @param configFactory A function returning your VoiceLineServerConfig. It receives the Nitro `peer` and `url`.
 * @returns An object compatible with Nitro's `defineWebSocketHandler`.
 */
export function createNitroWebSocketHandler(
  configFactory: (peer: any, url: URL, wsListeners: Record<string, Function[]>) => VoiceLineServerConfig | Promise<VoiceLineServerConfig>
) {
  // Store peer contexts to route messages and handle closures
  const peerContexts = new WeakMap<
    any,
    { listeners: Record<string, Function[]>; server?: ReturnType<typeof createServer>; session?: any; sessionId?: string }
  >();

  return {
    async open(peer: any) {
      const url = new URL(peer.url, "http://localhost");
      const ctx: {
        listeners: Record<string, Function[]>;
        server?: ReturnType<typeof createServer>;
        session?: any;
        sessionId?: string;
      } = { listeners: {} };
      peerContexts.set(peer, ctx);

      try {
        const config = await configFactory(peer, url, ctx.listeners);
        const maxSessions = config.maxSessions ?? DEFAULT_MAX_SESSIONS;

        // Process-wide cap (SessionManager is per-peer for socket-bound transports).
        if (maxSessions > 0 && nitroLiveSessions.size >= maxSessions) {
          console.error(
            `[voice-line] Session limit reached (${maxSessions}). Rejecting peer.`,
          );
          try {
            peer.close(1013, "Session limit reached");
          } catch {
            peer.close();
          }
          return;
        }

        const server = createServer({
          ...config,
          // Per-peer manager only holds one session; global Set enforces the real cap.
          maxSessions: maxSessions > 0 ? 1 : 0,
        });
        ctx.server = server;

        // Use the raw peer.id or session query param
        const sessionId = url.searchParams.get("session") ?? peer.id;

        // For raw WebSockets, the config's transport property is already the connected socket!
        // `createServer.createSession` will call `session.start()`, which waits for transport connect.
        // `WsTransport.connect` resolves instantly since the socket is already open.
        const { session } = await server.createSession(sessionId);
        ctx.session = session;
        ctx.sessionId = session.id;
        nitroLiveSessions.add(session.id);
      } catch (err) {
        console.error("[voice-line] Failed to start WS session:", err);
        peer.close();
      }
    },
    async message(peer: any, message: any) {
      // crossws Node adapter often loses the isBinary flag and treats text as Buffer
      let raw = message.rawData;
      let isBinary = typeof message.isBinary === "boolean" ? message.isBinary : typeof raw !== "string";
      
      // Fallback: If it's technically a Buffer, check if it's actually a JSON event
      if (isBinary && raw && typeof raw === "object") {
        const buf = Buffer.isBuffer(raw) ? raw : new Uint8Array(raw as any);
        if (buf[0] === 123) { // 123 is '{'
          try {
            JSON.parse(new TextDecoder().decode(buf));
            isBinary = false; // It's valid JSON, so it's a text frame!
          } catch {
            // Not valid JSON, keep as binary
          }
        }
      }

      let data = isBinary ? message.arrayBuffer() : message.text();
      if (data instanceof Promise) {
        data = await data;
      }
      
      if (!isBinary && typeof data !== "string") {
        if (Buffer.isBuffer(data)) data = data.toString("utf-8");
        else if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data);
        else data = String(data);
      } else if (isBinary) {
        if (data instanceof ArrayBuffer) {
          // already an ArrayBuffer
        } else if (Buffer.isBuffer(data)) {
          data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        } else if (ArrayBuffer.isView(data)) {
          data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        }
      }

      const ctx = peerContexts.get(peer);
      const listeners = ctx?.listeners?.message || [];
      listeners.forEach((l: any) => l({ data }));
    },
    close(peer: any) {
      const ctx = peerContexts.get(peer);
      if (ctx?.sessionId) {
        nitroLiveSessions.delete(ctx.sessionId);
      }
      const listeners = ctx?.listeners?.close || [];
      listeners.forEach((l: any) => l());
      // Always catch — unhandled rejections during WS teardown crash Node.
      void ctx?.session?.close()?.catch((err: unknown) => {
        console.error("[voice-line] session close failed:", err);
      });
    },
    error(peer: any, error: any) {
      const ctx = peerContexts.get(peer);
      const listeners = ctx?.listeners?.error || [];
      listeners.forEach((l: any) => l(error));
    },
  };
}

