import type { Frame, Processor } from "../interfaces/processor.js";
import {
  DEFAULT_VAD_CONFIG,
  type VADConfig,
} from "../types.js";
import { pcm16ToFloat32, rmsEnergy } from "../utils/audio.js";

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
          const frames: Frame[] = [{ kind: "speech_start" }];
          for (const b of this.buffer) {
            frames.push({ kind: "audio", data: b, sampleRate: this.sampleRate });
          }
          return frames;
        }
      } else {
        this.speechAccumMs = 0;
        // Keep a small pre-roll; drop older silence
        if (this.buffer.length > 5) {
          this.buffer = this.buffer.slice(-3);
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
