import { describe, expect, it } from "vitest";
import { encodeWav, renderSynth, renderSynthWav } from "../src/audio/synth";

const base = { wave: "sine" as const, frequency: 440, durationMs: 100, volume: 0.5 };

describe("renderSynth", () => {
  it("renders the expected number of frames", () => {
    const samples = renderSynth(base, 8_000);
    expect(samples.length).toBe(800);
  });

  it("is deterministic", () => {
    const a = renderSynth({ ...base, wave: "noise" }, 8_000);
    const b = renderSynth({ ...base, wave: "noise" }, 8_000);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("stays inside [-1, 1]", () => {
    for (const wave of ["sine", "square", "triangle", "sawtooth", "noise"] as const) {
      const samples = renderSynth({ ...base, wave, volume: 1 }, 8_000);
      for (const sample of samples) {
        expect(sample).toBeGreaterThanOrEqual(-1);
        expect(sample).toBeLessThanOrEqual(1);
      }
    }
  });

  it("respects volume", () => {
    const quiet = renderSynth({ ...base, volume: 0.1, decay: 0 }, 8_000);
    const loud = renderSynth({ ...base, volume: 0.8, decay: 0 }, 8_000);
    const peak = (samples: Float32Array) => Math.max(...Array.from(samples, Math.abs));
    expect(peak(loud)).toBeGreaterThan(peak(quiet) * 4);
  });

  it("splits notes evenly across the duration", () => {
    const samples = renderSynth(
      { ...base, notes: [220, 880], durationMs: 100, decay: 0 },
      8_000,
    );
    const firstHalf = Math.max(...Array.from(samples.slice(0, 400), Math.abs));
    const secondHalf = Math.max(...Array.from(samples.slice(400), Math.abs));
    // Both halves must contain audible signal; a broken segmentation would
    // leave one silent.
    expect(firstHalf).toBeGreaterThan(0.05);
    expect(secondHalf).toBeGreaterThan(0.05);
  });

  it("does not produce NaN for zero-length or single-frame specs", () => {
    const samples = renderSynth({ ...base, durationMs: 0.01 }, 1_000);
    expect(samples.length).toBe(1);
    expect(Number.isFinite(samples[0] ?? 0)).toBe(true);
  });
});

describe("encodeWav", () => {
  it("writes a valid mono 16-bit PCM header", () => {
    const samples = renderSynth(base, 8_000);
    const bytes = encodeWav(samples, 8_000);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...bytes.slice(offset, offset + length));

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(bytes.length).toBe(44 + samples.length * 2);
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
  });

  it("clamps out-of-range samples", () => {
    const bytes = encodeWav(new Float32Array([5, -5, Number.NaN]), 8_000);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0);
  });

  it("renderSynthWav combines both steps", () => {
    const bytes = renderSynthWav(base, 8_000);
    expect(bytes.length).toBe(44 + 800 * 2);
  });
});
