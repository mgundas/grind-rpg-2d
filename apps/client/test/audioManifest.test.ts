import { describe, expect, it } from "vitest";
import {
  MUSIC_BY_MAP,
  musicKeyForMap,
  parseAudioManifest,
  type AudioManifest,
} from "../src/assets/audioManifest";
import { MAP_IDS } from "@jadethrone/shared";

const synth = { wave: "sine", frequency: 440, durationMs: 100, volume: 0.4 };

function minimalMusic() {
  return Object.fromEntries(
    [...new Set(MAP_IDS.map((mapId) => MUSIC_BY_MAP[mapId]))].map((key) => [
      key,
      { path: `audio/music/${key.slice(6)}.ogg`, synth },
    ]),
  );
}

function validManifest(): Record<string, unknown> {
  return {
    version: 1,
    sounds: {
      "sfx.hit": { path: "audio/sfx/hit.wav", synth },
    },
    music: minimalMusic(),
  };
}

describe("parseAudioManifest", () => {
  it("accepts a valid manifest", () => {
    const manifest: AudioManifest = parseAudioManifest(validManifest());
    expect(manifest.version).toBe(1);
    expect(manifest.sounds["sfx.hit"]?.path).toBe("audio/sfx/hit.wav");
  });

  it("rejects a non-object root", () => {
    expect(() => parseAudioManifest([1, 2])).toThrow(/root must be an object/);
  });

  it("rejects a bad version", () => {
    expect(() => parseAudioManifest({ ...validManifest(), version: 0 })).toThrow(/positive integer/);
  });

  it("rejects a key in the wrong section", () => {
    const value = validManifest();
    value.sounds = { "music.village": { path: "x.wav", synth } };
    expect(() => parseAudioManifest(value)).toThrow(/must start with "sfx\."/);
  });

  it("rejects an unknown wave", () => {
    const value = validManifest();
    value.sounds = {
      "sfx.hit": { path: "x.wav", synth: { ...synth, wave: "organ" } },
    };
    expect(() => parseAudioManifest(value)).toThrow(/wave must be one of/);
  });

  it("rejects a non-positive duration", () => {
    const value = validManifest();
    value.sounds = {
      "sfx.hit": { path: "x.wav", synth: { ...synth, durationMs: 0 } },
    };
    expect(() => parseAudioManifest(value)).toThrow(/durationMs must be a positive/);
  });

  it("rejects a volume outside 0..1", () => {
    const value = validManifest();
    value.sounds = {
      "sfx.hit": { path: "x.wav", synth: { ...synth, volume: 1.5 } },
    };
    expect(() => parseAudioManifest(value)).toThrow(/volume must be between 0 and 1/);
  });

  it("rejects invalid throttle and voice settings", () => {
    const value = validManifest();
    value.sounds = {
      "sfx.hit": { path: "x.wav", synth, maxVoices: 0 },
    };
    expect(() => parseAudioManifest(value)).toThrow(/maxVoices/);

    value.sounds = { "sfx.hit": { path: "x.wav", synth, minIntervalMs: -1 } };
    expect(() => parseAudioManifest(value)).toThrow(/minIntervalMs/);
  });

  it("requires music for every map", () => {
    const value = validManifest();
    value.music = {};
    expect(() => parseAudioManifest(value)).toThrow(/missing music for maps/);
  });

  it("accepts optional notes and glide", () => {
    const value = validManifest();
    value.sounds = {
      "sfx.gold": {
        path: "x.wav",
        synth: { ...synth, notes: [880, 1175], endFrequency: 1320, decay: 0.5 },
      },
    };
    const manifest = parseAudioManifest(value);
    expect(manifest.sounds["sfx.gold"]?.synth.notes).toEqual([880, 1175]);
    expect(manifest.sounds["sfx.gold"]?.synth.endFrequency).toBe(1320);
  });
});

describe("musicKeyForMap", () => {
  it("maps every map to a music key", () => {
    for (const mapId of MAP_IDS) {
      expect(MUSIC_BY_MAP[mapId]).toMatch(/^music\./);
      expect(musicKeyForMap(mapId)).toBe(MUSIC_BY_MAP[mapId]);
    }
  });

  it("falls back to the village theme", () => {
    // Cast is deliberate: this pins the defensive fallback for stale map ids.
    expect(musicKeyForMap("map_unknown" as never)).toBe("music.village");
  });
});
