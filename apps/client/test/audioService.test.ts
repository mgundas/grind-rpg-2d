import { describe, expect, it } from "vitest";
import {
  AudioService,
  DEFAULT_AUDIO_SETTINGS,
  PlaybackGate,
  clampVolume,
  volumeForChannel,
} from "../src/audio/service";
import { MUSIC_BY_MAP, parseAudioManifest } from "../src/assets/audioManifest";
import { MAP_IDS } from "@jadethrone/shared";

class FakeParam {
  value = 1;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  cancelScheduledValues(): void {}
}

class FakeGain {
  gain = new FakeParam();
  connect(): void {}
  disconnect(): void {}
}

class FakeSource {
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  connect(): void {}
  start(): void {}
  stop(): void {}
}

class FakeContext {
  state = "suspended";
  sampleRate = 44_100;
  currentTime = 0;
  destination = {};
  decoded: Uint8Array[] = [];
  sources: FakeSource[] = [];

  createGain(): FakeGain {
    return new FakeGain();
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    this.decoded.push(new Uint8Array(bytes.slice(0)));
    return Promise.resolve({ duration: 1 } as AudioBuffer);
  }

  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

const synth = { wave: "sine" as const, frequency: 440, durationMs: 50, volume: 0.4 };

function testManifest() {
  return parseAudioManifest({
    version: 1,
    sounds: {
      "sfx.hit": { path: "audio/sfx/hit.wav", synth, maxVoices: 2, minIntervalMs: 50 },
    },
    music: Object.fromEntries(
      [...new Set(MAP_IDS.map((mapId) => MUSIC_BY_MAP[mapId]))].map((key) => [
        key,
        { path: `audio/music/${key.slice(6)}.ogg`, synth },
      ]),
    ),
  });
}

describe("volume helpers", () => {
  it("clamps non-finite and out-of-range values", () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
  });

  it("applies mute at the master only", () => {
    const settings = { ...DEFAULT_AUDIO_SETTINGS, muted: true, musicVolume: 0.5 };
    expect(volumeForChannel(settings, "master")).toBe(0);
    expect(volumeForChannel(settings, "music")).toBe(0.5);
  });

  it("exposes each channel independently", () => {
    const settings = { masterVolume: 0.5, musicVolume: 0.25, sfxVolume: 0.75, muted: false };
    expect(volumeForChannel(settings, "master")).toBe(0.5);
    expect(volumeForChannel(settings, "music")).toBe(0.25);
    expect(volumeForChannel(settings, "sfx")).toBe(0.75);
  });
});

describe("PlaybackGate", () => {
  it("throttles a key by its min interval", () => {
    let now = 0;
    const gate = new PlaybackGate(() => now);
    const entry = { maxVoices: 2, minIntervalMs: 100 };
    expect(gate.canPlay("sfx.hit", entry)).toBe(true);
    gate.markStarted("sfx.hit");
    now = 50;
    expect(gate.canPlay("sfx.hit", entry)).toBe(false);
    now = 150;
    expect(gate.canPlay("sfx.hit", entry)).toBe(true);
  });

  it("defaults to one voice", () => {
    const gate = new PlaybackGate(() => 0);
    expect(gate.canPlay("sfx.hit", {})).toBe(true);
    gate.markStarted("sfx.hit");
    expect(gate.canPlay("sfx.hit", {})).toBe(false);
    gate.markEnded("sfx.hit");
    expect(gate.canPlay("sfx.hit", {})).toBe(true);
  });

  it("frees a voice when playback ends", () => {
    const gate = new PlaybackGate(() => 0);
    const entry = { maxVoices: 2 };
    gate.markStarted("x");
    gate.markStarted("x");
    expect(gate.activeVoices("x")).toBe(2);
    expect(gate.canPlay("x", entry)).toBe(false);
    gate.markEnded("x");
    expect(gate.canPlay("x", entry)).toBe(true);
  });
});

describe("AudioService", () => {
  it("falls back to synth bytes when the file is missing", async () => {
    const context = new FakeContext();
    const service = new AudioService({
      createContext: () => context as unknown as AudioContext,
      fetchBytes: async () => null,
      now: () => 0,
      warn: () => {},
    });
    service.setManifest(testManifest());
    await service.preloadSounds();

    expect(context.decoded).toHaveLength(1);
    const wav = context.decoded[0]!;
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
  });

  it("prefers a real file over the synth fallback", async () => {
    const context = new FakeContext();
    const fileBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const service = new AudioService({
      createContext: () => context as unknown as AudioContext,
      fetchBytes: async () => fileBytes,
      now: () => 0,
      warn: () => {},
    });
    service.setManifest(testManifest());
    await service.preloadSounds();

    expect(context.decoded[0]).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("decodes each key once and caches the buffer", async () => {
    const context = new FakeContext();
    const service = new AudioService({
      createContext: () => context as unknown as AudioContext,
      fetchBytes: async () => null,
      now: () => 0,
      warn: () => {},
    });
    service.setManifest(testManifest());
    await service.preloadSounds();
    await service.preloadSounds();
    expect(context.decoded).toHaveLength(1);
  });

  it("does nothing without a manifest or a context", async () => {
    const service = new AudioService({
      createContext: () => null,
      fetchBytes: async () => null,
      warn: () => {},
    });
    service.setManifest(testManifest());
    await expect(service.preloadSounds()).resolves.toBeUndefined();
    expect(() => service.playSfx("sfx.hit")).not.toThrow();
    expect(() => service.playMusic("music.village")).not.toThrow();
  });

  it("resumes a suspended context on demand", async () => {
    const context = new FakeContext();
    const service = new AudioService({
      createContext: () => context as unknown as AudioContext,
      fetchBytes: async () => null,
      warn: () => {},
    });
    service.setManifest(testManifest());
    await service.resume();
    expect(context.state).toBe("running");
  });

  it("respects the mute setting when gains are applied", async () => {
    const context = new FakeContext();
    const service = new AudioService({
      createContext: () => context as unknown as AudioContext,
      fetchBytes: async () => null,
      warn: () => {},
    });
    service.setManifest(testManifest());
    await service.preloadSounds();
    service.setSettings({ ...DEFAULT_AUDIO_SETTINGS, muted: true });
    expect(volumeForChannel(service.getSettings(), "master")).toBe(0);
    expect(service.getSettings().muted).toBe(true);
  });
});
