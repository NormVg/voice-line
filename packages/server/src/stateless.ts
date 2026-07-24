import type { Brain, STTConfig, STTProvider, TTSConfig, TTSProvider, TranscriptResult } from "@voice-line/core";
import { SentenceChunker, brainToStream } from "@voice-line/core";

export interface StatelessHandlerConfig {
  stt: STTProvider;
  tts: TTSProvider;
  brain: Brain;
  sttConfig?: STTConfig;
  ttsConfig?: TTSConfig;
}

/**
 * Creates a stateless audio-in → audio-out processor.
 */
export function createStatelessHandlerBase(config: StatelessHandlerConfig) {
  return async function* handleStateless(
    audioPayload: ArrayBuffer,
    overrideSTT?: STTConfig,
    overrideTTS?: TTSConfig
  ): AsyncIterable<ArrayBuffer> {
    
    // 1. STT Pipeline
    const sttConfig = { ...config.sttConfig, ...overrideSTT };
    const sttStream = config.stt.createStream(sttConfig);
    
    let finalTranscript = "";
    
    const transcriptPromise = new Promise<void>((resolve, reject) => {
      sttStream.on("transcript", (res: TranscriptResult) => {
        if (res.isFinal) {
          finalTranscript = res.text;
          resolve();
        }
      });
      sttStream.on("error", reject);
    });

    sttStream.write(audioPayload);
    sttStream.flush?.(); // Force flush
    
    await transcriptPromise;
    await sttStream.close();

    if (!finalTranscript.trim()) {
      return; // No speech detected
    }

    // 2. Brain Pipeline
    const sessionId = "stl_" + Math.random().toString(36).substring(2, 9);
    const abortController = new AbortController();
    const brainResult = config.brain(finalTranscript, {
      sessionId,
      history: [],
      interrupt: () => { abortController.abort(); },
      signal: abortController.signal,
      metadata: {}
    });

    const stream = brainToStream(brainResult);

    // 3. Sentence Chunker + TTS Pipeline
    const chunker = new SentenceChunker();
    
    const processFrame = async function* (frame: any): AsyncIterable<ArrayBuffer> {
      const outFrames = chunker.process(frame);
      if (outFrames && Array.isArray(outFrames)) {
        for (const out of outFrames) {
          if (out.kind === "sentence" && out.text) {
            const ttsStream = config.tts.synthesize(out.text, { ...config.ttsConfig, ...overrideTTS });
            for await (const audioChunk of ttsStream) {
              yield audioChunk.data;
            }
          }
        }
      }
    };

    for await (const token of stream) {
      yield* processFrame({ kind: "text", text: token });
    }
    yield* processFrame({ kind: "flush" });
  };
}
