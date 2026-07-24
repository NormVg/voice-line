import { describe, expect, it } from "vitest";
import {
  float32ToPcm16,
  pcm16ToFloat32,
  pcm16ToWav,
  rmsEnergy,
} from "../src/utils/audio.js";

describe("audio utils", () => {
  it("round-trips float32 ↔ pcm16", () => {
    const original = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const pcm = float32ToPcm16(original);
    const back = pcm16ToFloat32(pcm);
    expect(back.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs((back[i] ?? 0) - (original[i] ?? 0))).toBeLessThan(0.01);
    }
  });

  it("computes rms energy", () => {
    expect(rmsEnergy(new Float32Array([0, 0, 0]))).toBe(0);
    expect(rmsEnergy(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1, 5);
  });

  it("wraps pcm in wav header", () => {
    const pcm = float32ToPcm16(new Float32Array(160));
    const wav = pcm16ToWav(pcm, 16000);
    const view = new DataView(wav);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe(
      "RIFF",
    );
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
  });
});
