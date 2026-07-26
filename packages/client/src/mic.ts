import { float32ToPcm16, resample } from "@voice-line/core";
import { resumeAudioContext } from "./audio-context.js";

export interface MicOptions {
  /** Target sample rate for outbound PCM (default 16000). */
  sampleRate?: number;
  /** Chunk duration in ms (default 100). */
  chunkDurationMs?: number;
  onChunk: (pcm: ArrayBuffer) => void;
  onError?: (error: Error) => void;
  /**
   * Shared AudioContext (preferred — same graph as Speaker for better AEC).
   * When omitted, Mic creates and owns its own context.
   */
  context?: AudioContext;
}

/**
 * Microphone capture via MediaStream + ScriptProcessor.
 * Emits PCM16 LE chunks at the target sample rate.
 */
export class Microphone {
  private readonly targetRate: number;
  private readonly chunkDurationMs: number;
  private readonly onChunk: (pcm: ArrayBuffer) => void;
  private readonly onError: ((error: Error) => void) | undefined;
  private readonly externalContext: AudioContext | null;

  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private ownsContext = false;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private enabled = false;

  constructor(options: MicOptions) {
    this.targetRate = options.sampleRate ?? 16_000;
    this.chunkDurationMs = options.chunkDurationMs ?? 100;
    this.onChunk = options.onChunk;
    this.onError = options.onError;
    this.externalContext = options.context ?? null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async start(): Promise<void> {
    if (this.stream) {
      this.enabled = true;
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (this.externalContext) {
        this.context = this.externalContext;
        this.ownsContext = false;
      } else {
        this.context = new AudioContext();
        this.ownsContext = true;
      }
      await resumeAudioContext(this.context);

      this.source = this.context.createMediaStreamSource(this.stream);

      const bufferSize = 4096;
      this.processor = this.context.createScriptProcessor(bufferSize, 1, 1);

      let pending = new Float32Array(0);
      const samplesPerChunk = Math.floor((this.targetRate * this.chunkDurationMs) / 1000);

      this.processor.onaudioprocess = (event) => {
        // Zero out the output buffer to prevent local mic echo through the graph
        for (let i = 0; i < event.outputBuffer.numberOfChannels; i++) {
          event.outputBuffer.getChannelData(i).fill(0);
        }

        if (!this.enabled) return;
        const input = event.inputBuffer.getChannelData(0);
        const ctxRate = this.context?.sampleRate ?? 48_000;
        const resampled =
          ctxRate === this.targetRate
            ? new Float32Array(input)
            : resample(new Float32Array(input), ctxRate, this.targetRate);

        const merged = new Float32Array(pending.length + resampled.length);
        merged.set(pending);
        merged.set(resampled, pending.length);
        pending = merged;

        while (pending.length >= samplesPerChunk) {
          const slice = pending.slice(0, samplesPerChunk);
          pending = pending.slice(samplesPerChunk);
          this.onChunk(float32ToPcm16(slice));
        }
      };

      this.sink = this.context.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(this.sink);
      this.sink.connect(this.context.destination);
      this.enabled = true;
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async stop(): Promise<void> {
    this.enabled = false;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.sink?.disconnect();
    this.processor = null;
    this.source = null;
    this.sink = null;
    if (this.ownsContext) {
      await this.context?.close().catch(() => {});
    }
    this.context = null;
    this.ownsContext = false;
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
  }
}
