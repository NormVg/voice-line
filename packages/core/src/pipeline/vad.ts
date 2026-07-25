import type { Frame, Processor } from "../interfaces/processor.js";
import { DEFAULT_VAD_CONFIG, type VADConfig } from "../types.js";
import { pcm16ToFloat32, rmsEnergy } from "../utils/audio.js";

/**
 * How many silence frames to keep as pre-roll so the start of an
 * utterance is never clipped. At 100 ms / chunk this is ~1 second.
 */
const PRE_ROLL_FRAMES = 10;

/**
 * Energy-based Voice Activity Detection.
 *
 * Emits speech_start / speech_end frames and buffers utterance audio.
 * Pure TypeScript — no ONNX runtime. Suitable for foundation; swap for
 * Silero later behind the same Processor interface if needed.
 */
export class VADProcessor implements Processor {
  readonly name = "vad";

  private readonly config: VADConfig;
  private speaking = false;
  private silenceAccumMs = 0;
  private speechAccumMs = 0;
  private buffer: ArrayBuffer[] = [];
  private sampleRate = 16_000;

  constructor(config: Partial<VADConfig> = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  process(frame: Frame): Frame | Frame[] | null {
    if (frame.kind === "flush") {
      return this.flush();
    }
    if (frame.kind !== "audio") {
      return frame;
    }

    this.sampleRate = frame.sampleRate;
    const samples = pcm16ToFloat32(frame.data);
    const energy = rmsEnergy(samples);
    // Map RMS (~0–0.3 typical speech) into a 0–1-ish confidence proxy.
    const confidence = Math.min(1, energy * 8);
    const chunkMs = (samples.length / frame.sampleRate) * 1000;

    this.buffer.push(frame.data);

    if (!this.speaking) {
      if (confidence >= this.config.confidence) {
        this.speechAccumMs += chunkMs;
        if (this.speechAccumMs >= this.config.minSpeechMs) {
          this.speaking = true;
          this.silenceAccumMs = 0;
          // Flush the entire pre-roll buffer so the STT receives the
          // audio that preceded the speech detection threshold.
          const frames: Frame[] = [{ kind: "speech_start" }];
          for (const b of this.buffer) {
            frames.push({ kind: "audio", data: b, sampleRate: this.sampleRate });
          }
          return frames;
        }
      } else {
        // Decay instead of hard-reset: a single quiet frame shouldn't
        // throw away all accumulated evidence of speech onset.
        this.speechAccumMs = Math.max(0, this.speechAccumMs - chunkMs);
        // Keep a generous pre-roll so early syllables aren't clipped.
        if (this.buffer.length > PRE_ROLL_FRAMES) {
          this.buffer = this.buffer.slice(-PRE_ROLL_FRAMES);
        }
      }
      return null;
    }

    // speaking
    if (confidence < this.config.confidence) {
      this.silenceAccumMs += chunkMs;
      if (this.silenceAccumMs >= this.config.silenceMs) {
        return this.endSpeech();
      }
    } else {
      this.silenceAccumMs = 0;
    }

    return frame;
  }

  reset(): void {
    this.speaking = false;
    this.silenceAccumMs = 0;
    this.speechAccumMs = 0;
    this.buffer = [];
  }

  private endSpeech(): Frame[] {
    const audio = concatBuffers(this.buffer);
    this.speaking = false;
    this.silenceAccumMs = 0;
    this.speechAccumMs = 0;
    this.buffer = [];
    return [
      {
        kind: "speech_end",
        audio,
        sampleRate: this.sampleRate,
      },
    ];
  }

  private flush(): Frame | Frame[] | null {
    if (this.speaking && this.buffer.length > 0) {
      return this.endSpeech();
    }
    this.reset();
    return { kind: "flush" };
  }
}

function concatBuffers(chunks: ArrayBuffer[]): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(new Uint8Array(c), offset);
    offset += c.byteLength;
  }
  return out.buffer;
}
