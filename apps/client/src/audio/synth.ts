/**
 * Procedural audio placeholders (GAME_DESIGN.md §2.1): when an audio file is
 * missing, the client synthesises a deterministic tone or noise burst under
 * the same logical key. Pure WebAudio-free maths so it can be unit tested in
 * Node; `audio/service.ts` feeds the samples into an `AudioBuffer`.
 */

import { mulberry32, seedFromString } from "@jadethrone/shared";
import type { SynthSpec } from "../assets/audioManifest";

export const DEFAULT_SAMPLE_RATE = 44_100;

const ATTACK_MS = 4;
const RELEASE_FRACTION = 0.12;

function seconds(ms: number): number {
  return ms / 1000;
}

function envelopeAt(frame: number, totalFrames: number, sampleRate: number): number {
  const attackFrames = Math.max(1, Math.round(seconds(ATTACK_MS) * sampleRate));
  const releaseFrames = Math.max(1, Math.round(totalFrames * RELEASE_FRACTION));
  const attack = frame < attackFrames ? frame / attackFrames : 1;
  const remaining = totalFrames - frame;
  const release = remaining < releaseFrames ? remaining / releaseFrames : 1;
  return attack * release;
}

function decayAt(frame: number, totalFrames: number, decay: number): number {
  if (decay <= 0) {
    return 1;
  }
  const progress = totalFrames <= 1 ? 1 : frame / (totalFrames - 1);
  return Math.exp(-decay * 5 * progress);
}

function waveSample(wave: SynthSpec["wave"], phase: number, noise: () => number): number {
  switch (wave) {
    case "sine":
      return Math.sin(phase);
    case "square":
      return Math.sin(phase) >= 0 ? 1 : -1;
    case "triangle":
      return (2 / Math.PI) * Math.asin(Math.sin(phase));
    case "sawtooth": {
      const wrapped = phase / (Math.PI * 2);
      return 2 * (wrapped - Math.floor(wrapped)) - 1;
    }
    case "noise":
      return noise() * 2 - 1;
  }
}

/**
 * Renders a synth spec into mono float samples in [-1, 1].
 *
 * Deterministic for a given spec + sample rate: noise uses a PRNG seeded from
 * the spec so tests and repeated playbacks are stable.
 */
export function renderSynth(
  spec: SynthSpec,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): Float32Array {
  const totalFrames = Math.max(1, Math.round(seconds(spec.durationMs) * sampleRate));
  const samples = new Float32Array(totalFrames);
  const noise = mulberry32(seedFromString(`${spec.wave}:${spec.frequency}:${spec.durationMs}`));
  const notes = spec.notes && spec.notes.length > 0 ? spec.notes : [spec.frequency];
  const segmentFrames = Math.max(1, Math.floor(totalFrames / notes.length));
  const decay = spec.decay ?? 0;

  let phase = 0;
  for (let frame = 0; frame < totalFrames; frame++) {
    const segment = Math.min(notes.length - 1, Math.floor(frame / segmentFrames));
    const segmentStart = segment * segmentFrames;
    const segmentProgress =
      segment === notes.length - 1
        ? Math.min(1, (frame - segmentStart) / Math.max(1, totalFrames - segmentStart - 1))
        : (frame - segmentStart) / Math.max(1, segmentFrames - 1);
    const startFrequency = notes[segment] ?? spec.frequency;
    const endFrequency = spec.endFrequency ?? startFrequency;
    const frequency = startFrequency + (endFrequency - startFrequency) * segmentProgress;

    phase += (Math.PI * 2 * frequency) / sampleRate;
    if (phase > Math.PI * 2 * 1024) {
      phase %= Math.PI * 2;
    }

    const value = waveSample(spec.wave, phase, noise);
    samples[frame] =
      value * spec.volume * envelopeAt(frame, totalFrames, sampleRate) * decayAt(frame, totalFrames, decay);
  }
  return samples;
}

/** Encodes mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): Uint8Array {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(44 + i * 2, int16, true);
  }
  return new Uint8Array(buffer);
}

/** Convenience: render and encode in one call (used by the placeholder path). */
export function renderSynthWav(
  spec: SynthSpec,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): Uint8Array {
  return encodeWav(renderSynth(spec, sampleRate), sampleRate);
}
