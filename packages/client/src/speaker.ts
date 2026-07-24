/**
 * Continuous PCM16 playback via Web Audio API.
 *
 * Uses a single ScriptProcessorNode pulling from a FIFO queue
 * of Float32 samples. This produces one seamless audio stream
 * with zero boundary clicks — unlike scheduling many separate
 * AudioBufferSourceNodes which causes audible ticks at every
 * chunk boundary.
 *
 * Supports immediate flush on interruption.
 */
export class Speaker {
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private fifo: Float32Array[] = [];
  private fifoOffset = 0;
  private _playing = false;
  private readonly sampleRate: number;
  /** Counts silent process callbacks so we can auto-stop. */
  private silentRuns = 0;

  constructor(sampleRate = 16_000) {
    this.sampleRate = sampleRate;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext({ sampleRate: this.sampleRate });
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    if (!this.processor) {
      // 2048 frames at 16 kHz ≈ 128 ms — low enough latency, high enough
      // that the main-thread callback is cheap.
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

        // Silence for the remainder of the buffer
        if (written < output.length) {
          output.fill(0, written);
        }

        if (written > 0) {
          this._playing = true;
          this.silentRuns = 0;
        } else {
          this.silentRuns++;
          // After ~0.5 s of silence mark as not playing
          if (this.silentRuns > 4) {
            this._playing = false;
          }
        }
      };
      this.processor.connect(this.context.destination);
    }
    return this.context;
  }

  async enqueue(pcm: ArrayBuffer, _sampleRate?: number): Promise<void> {
    await this.ensureContext();
    const samples = pcm16ToFloat32(pcm);
    if (samples.length === 0) return;
    this.fifo.push(samples);
    this._playing = true;
    this.silentRuns = 0;
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
    await this.context?.close();
    this.context = null;
  }
}

/** Convert PCM16-LE ArrayBuffer to normalized Float32Array. */
function pcm16ToFloat32(pcm: ArrayBuffer): Float32Array {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  const out = new Float32Array(sampleCount);
  const view = new DataView(pcm);
  for (let i = 0; i < sampleCount; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s / (s < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}
