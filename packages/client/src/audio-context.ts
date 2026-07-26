/**
 * Shared AudioContext helpers for mic + speaker.
 * One context per VoiceLineClient improves AEC correlation vs dual graphs.
 */

export type AudioContextLike = AudioContext;

/** Create a browser AudioContext (optionally hinting a sample rate). */
export function createVoiceAudioContext(sampleRate?: number): AudioContext {
  const Ctor =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio API is not available in this environment");
  }
  return sampleRate ? new Ctor({ sampleRate }) : new Ctor();
}

export async function resumeAudioContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}
