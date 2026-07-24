import type { Brain, BrainContext, Message } from "@voice-line/core";

/**
 * Minimal surface we need from the AI SDK `streamText` result.
 * Avoids hard-coding unstable option types — pass through via `streamText` options.
 */
export interface AISDKStreamTextResult {
  textStream: AsyncIterable<string>;
}

export type StreamTextFn = (options: Record<string, unknown>) => AISDKStreamTextResult;

export interface FromAISDKOptions {
  /**
   * Language model instance (e.g. `openai('gpt-4o')`).
   * Typed as unknown so we don't pin to a specific AI SDK version's Model type.
   */
  model: unknown;
  system?: string;
  tools?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  /**
   * Inject `streamText` for testing or version pinning.
   * Defaults to dynamic `import('ai').streamText`.
   */
  streamText?: StreamTextFn;
  /** Extra options forwarded to streamText. */
  extra?: Record<string, unknown>;
}

/**
 * Wrap Vercel AI SDK `streamText()` as a voice-line Brain.
 *
 * ```ts
 * brain: fromAISDK({
 *   model: openai('gpt-4o'),
 *   system: 'You are a helpful voice assistant. Keep responses concise.',
 * })
 * ```
 */
export function fromAISDK(options: FromAISDKOptions): Brain {
  return async function* aiSdkBrain(
    userText: string,
    ctx: BrainContext,
  ): AsyncGenerator<string, void, unknown> {
    const streamText = options.streamText ?? (await loadStreamText());

    const messages = toCoreMessages(ctx.history, userText);

    const result = streamText({
      model: options.model,
      system: options.system,
      messages,
      tools: options.tools,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      abortSignal: ctx.signal,
      ...options.extra,
    });

    for await (const delta of result.textStream) {
      if (ctx.signal.aborted) break;
      yield delta;
    }
  };
}

function toCoreMessages(
  history: readonly Message[],
  userText: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const m of history) {
    messages.push({ role: m.role, content: m.content });
  }

  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || last.content !== userText) {
    messages.push({ role: "user", content: userText });
  }

  return messages;
}

async function loadStreamText(): Promise<StreamTextFn> {
  const mod = (await import("ai")) as unknown as { streamText?: StreamTextFn };
  const fn = mod.streamText;
  if (!fn) {
    throw new Error("Could not load streamText from 'ai'. Is the AI SDK installed?");
  }
  return fn;
}
