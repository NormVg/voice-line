/**
 * Queued PCM16 playback via Web Audio API.
 * Supports immediate flush on interruption.
 */
export class Speaker {
  private context: AudioContext | null = null;
  private queue: ArrayBuffer[] = [];
  private playing = false;
  private nextTime = 0;
  private sampleRate: number;
  private sources: AudioBufferSourceNode[] = [];

  constructor(sampleRate = 16_000) {
    this.sampleRate = sampleRate;
  }

  async ensureContext(): Promise<AudioContext> {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext({ sampleRate: this.sampleRate });
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return this.context;
  }

  async enqueue(pcm: ArrayBuffer, sampleRate?: number): Promise<void> {
    if (sampleRate) this.sampleRate = sampleRate;
    const ctx = await this.ensureContext();
    const audioBuffer = pcm16ToAudioBuffer(ctx, pcm, this.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now;
    source.start(this.nextTime);
    this.nextTime += audioBuffer.duration;
    this.sources.push(source);
    this.playing = true;

    source.onended = () => {
      this.sources = this.sources.filter((s) => s !== source);
      if (this.sources.length === 0) {
        this.playing = false;
      }
    };
  }

  /** Stop all playback immediately (interruption). */
  flush(): void {
    for (const source of this.sources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.queue = [];
    this.playing = false;
    if (this.context) {
      this.nextTime = this.context.currentTime;
    }
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  async destroy(): Promise<void> {
    this.flush();
    await this.context?.close();
    this.context = null;
  }
}

function pcm16ToAudioBuffer(
  ctx: AudioContext,
  pcm: ArrayBuffer,
  sampleRate: number,
): AudioBuffer {
  const samples = pcm.byteLength / 2;
  const buffer = ctx.createBuffer(1, samples, sampleRate);
  const channel = buffer.getChannelData(0);
  const view = new DataView(pcm);
  for (let i = 0; i < samples; i++) {
    const int16 = view.getInt16(i * 2, true);
    channel[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
  }
  return buffer;
}
