import type { VoiceLineServerConfig } from "./config.js";
import { createServer } from "./server.js";
import { createTTSHandlerBase, type TTSHandlerConfig } from "./tts-handler.js";
import { createStatelessHandlerBase, type StatelessHandlerConfig } from "./stateless.js";

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
  // If static config, create the server once globally.
  const staticServer = typeof configOrFactory === "function" ? null : createServer(configOrFactory);

  return async (event: {
    node?: { req?: { method?: string } };
    method?: string;
    context?: { body?: { sessionId?: string } };
  }) => {
    let currentConfig: VoiceLineServerConfig;
    if (typeof configOrFactory === "function") {
      currentConfig = await configOrFactory(event);
    } else {
      currentConfig = configOrFactory;
    }

    const server = staticServer ?? createServer(currentConfig);

    try {
      const body = event.context?.body ?? null;
      const { session, clientPayload } = await server.createSession(body?.sessionId);
      
      // If we created a dynamic server just for this request, close it when the session ends
      // to avoid leaking the session manager, OR we can just let it GC. 
      // Actually, SessionManager doesn't hold references outside of its sessions.
      
      return { sessionId: session.id, ...clientPayload };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      
      // We don't have currentConfig in scope if it fails before initialization, 
      // but try block is inside, so we do.
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
  configFactory: (peer: any, url: URL) => VoiceLineServerConfig | Promise<VoiceLineServerConfig>
) {
  // Store peer contexts to route messages and handle closures
  const peerContexts = new WeakMap<any, { listeners: Record<string, Function[]>; server?: ReturnType<typeof createServer>; session?: any }>();

  return {
    async open(peer: any) {
      const url = new URL(peer.url, "http://localhost");
      const ctx: { listeners: Record<string, Function[]>; server?: ReturnType<typeof createServer>; session?: any } = { listeners: {} };
      peerContexts.set(peer, ctx);

      try {
        const config = await configFactory(peer, url);
        const server = createServer(config);
        ctx.server = server;
        
        // Use the raw peer.id or session query param
        const sessionId = url.searchParams.get("session") ?? peer.id;
        
        // For raw WebSockets, the config's transport property is already the connected socket!
        // `createServer.createSession` will call `session.start()`, which waits for transport connect.
        // `WsTransport.connect` resolves instantly since the socket is already open.
        const { session } = await server.createSession(sessionId);
        ctx.session = session;
      } catch (err) {
        console.error("[voice-line] Failed to start WS session:", err);
        peer.close();
      }
    },
    message(peer: any, message: any) {
      const isBinary = typeof message.rawData !== "string";
      const data = isBinary ? message.arrayBuffer() : message.text();
      
      const ctx = peerContexts.get(peer);
      const listeners = ctx?.listeners?.message || [];
      listeners.forEach((l: any) => l({ data }));
    },
    close(peer: any) {
      const ctx = peerContexts.get(peer);
      const listeners = ctx?.listeners?.close || [];
      listeners.forEach((l: any) => l());
      void ctx?.session?.close();
    },
    error(peer: any, error: any) {
      const ctx = peerContexts.get(peer);
      const listeners = ctx?.listeners?.error || [];
      listeners.forEach((l: any) => l(error));
    },
  };
}

