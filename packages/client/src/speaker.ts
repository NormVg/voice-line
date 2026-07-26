import { pcm16ToFloat32, resample } from "@voice-line/core";
import { resumeAudioContext } from "./audio-context.js";

/**
 * Continuous PCM16 playback via Web Audio API.
 *
 * Uses a ScriptProcessorNode pulling from a FIFO of Float32 samples.
 * Accepts an optional shared AudioContext (same as Microphone) so the
 * browser can correlate playback with capture for echo cancellation.
 */
export class Speaker {
  private context: AudioContext | null = null;
  private ownsContext = false;
  private readonly externalContext: AudioContext | null;
  private processor: ScriptProcessorNode | null = null;
  private fifo: Float32Array[] = [];
  private fifoOffset = 0;
  private _playing = false;
  /** Wire / source PCM rate (usually 16 kHz from TTS). */
  private readonly sourceSampleRate: number;
  /** Counts silent process callbacks so we can auto-stop. */
  private silentRuns = 0;

  constructor(sampleRate = 16_000, context?: AudioContext) {
    this.sourceSampleRate = sampleRate;
    this.externalContext = context ?? null;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (this.context && this.context.state !== "closed") {
      await resumeAudioContext(this.context);
      return this.context;
    }

    if (this.externalContext && this.externalContext.state !== "closed") {
      this.context = this.externalContext;
      this.ownsContext = false;
    } else {
      // Prefer matching the wire rate when we own the context alone.
      this.context = new AudioContext({ sampleRate: this.sourceSampleRate });
      this.ownsContext = true;
    }
    await resumeAudioContext(this.context);

    if (!this.processor) {
      // 2048 frames — low enough latency, high enough that the callback is cheap.
      this.processor = this.context.createScriptProcessor(2048, 0, 1);
      this.processor.onaudioprocess = (e) => {
        const output = e.outputBuffer.getChannelData(0);
        let written = 0;

        while (written < output.length && this.fifo.length > 0) {
          const head = this.fifo[0];
          if (!head) break;
          const available = head.length - this.fifoOffset;
          const toWrite = Math.min(available, output.length - written);

          output.set(head.subarray(this.fifoOffset, this.fifoOffset + toWrite), written);
          written += toWrite;
          this.fifoOffset += toWrite;

          if (this.fifoOffset >= head.length) {
            this.fifo.shift();
            this.fifoOffset = 0;
          }
        }

        if (written < output.length) {
          output.fill(0, written);
        }

        if (written > 0) {
          this._playing = true;
          this.silentRuns = 0;
        } else {
          this.silentRuns++;
          if (this.silentRuns > 4) {
            this._playing = false;
          }
        }
      };
      this.processor.connect(this.context.destination);
    }
    return this.context;
  }

  enqueue(pcm: ArrayBuffer, sampleRate?: number): void {
    const srcRate = sampleRate ?? this.sourceSampleRate;
    let samples = pcm16ToFloat32(pcm);
    if (samples.length === 0) return;

    // Resample into the live context rate so shared 48 kHz contexts play at pitch.
    const ctxRate = this.context?.sampleRate ?? this.externalContext?.sampleRate ?? srcRate;
    if (ctxRate !== srcRate) {
      samples = resample(samples, srcRate, ctxRate);
    }

    this.fifo.push(samples);
    this._playing = true;
    this.silentRuns = 0;
    void this.ensureContext().catch(() => {
      /* resume failures are non-fatal; next enqueue retries */
    });
  }

  /** Stop all playback immediately (interruption). */
  flush(): void {
    this.fifo = [];
    this.fifoOffset = 0;
    this._playing = false;
    this.silentRuns = 0;
  }

  get isPlaying(): boolean {
    return this._playing;
  }

  async destroy(): Promise<void> {
    this.flush();
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.ownsContext) {
      await this.context?.close().catch(() => {});
    }
    this.context = null;
    this.ownsContext = false;
  }
}
