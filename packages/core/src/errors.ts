export type ErrorCode =
  | "ERR_TRANSPORT"
  | "ERR_TRANSPORT_AUTH"
  | "ERR_STT"
  | "ERR_TTS"
  | "ERR_BRAIN"
  | "ERR_TIMEOUT"
  | "ERR_INTERNAL";

export class VoiceLineError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VoiceLineError";
    Object.setPrototypeOf(this, VoiceLineError.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

/** Utility to cast unknown catches into VoiceLineError */
export function toVoiceLineError(code: ErrorCode, err: unknown): VoiceLineError {
  if (err instanceof VoiceLineError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new VoiceLineError(code, message, err);
}
