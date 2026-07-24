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
export function createEventHandler(config: VoiceLineServerConfig) {
  const server = createServer(config);

  return async (event: {
    node?: { req?: { method?: string } };
    method?: string;
    // h3 readBody is injected by the host; we accept a pre-parsed body via context
    context?: { body?: { sessionId?: string } };
  }) => {
    try {
      const body = event.context?.body ?? null;
      const session = await server.createSession(body?.sessionId);
      return { sessionId: session.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      config.onError?.(err instanceof Error ? err : new Error(message));
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
