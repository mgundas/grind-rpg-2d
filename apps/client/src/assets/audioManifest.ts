/**
 * Audio manifest: logical sound/music keys mapped to file paths plus a synth
 * spec used as a procedural placeholder (GAME_DESIGN.md §2.1 and §10.4).
 *
 * The audio manifest is deliberately separate from the visual `manifest.json`
 * so adding a sound never has to touch the texture pipeline. Game code only
 * ever sees logical keys (`sfx.hit`, `music.village`); whether the bytes come
 * from a committed file or the synthesised fallback is an implementation
 * detail of `audio/service.ts`.
 */

import { MAP_IDS, type MapId } from "@jadethrone/shared";

export type SynthWave = "sine" | "square" | "triangle" | "sawtooth" | "noise";

export interface SynthSpec {
  wave: SynthWave;
  /** Base frequency in Hz (ignored by `noise` when no glide is set). */
  frequency: number;
  /** Optional glide target; the renderer sweeps from `frequency` to this. */
  endFrequency?: number;
  /** Optional melody: each note owns an equal slice of `durationMs`. */
  notes?: number[];
  durationMs: number;
  /** Peak amplitude, 0..1. */
  volume: number;
  /** Exponential decay strength, 0 = sustained, 1 = fast decay. */
  decay?: number;
}

export interface AudioEntry {
  /** Path relative to `/assets/`. */
  path: string;
  synth: SynthSpec;
  /** Per-entry volume multiplier, 0..1 (defaults to 1). */
  volume?: number;
  /** Maximum simultaneous voices for this key (defaults to 1). */
  maxVoices?: number;
  /** Minimum spacing between two plays of this key in ms (defaults to 0). */
  minIntervalMs?: number;
}

export interface AudioManifest {
  version: number;
  sounds: Record<string, AudioEntry>;
  music: Record<string, AudioEntry>;
}

export const DEFAULT_AUDIO_MANIFEST_URL = "/assets/audio.json";

const WAVES: ReadonlySet<string> = new Set(["sine", "square", "triangle", "sawtooth", "noise"]);
const MAX_DURATION_MS = 120_000;
const MAX_VOICES = 16;
const MAX_THROTTLE_MS = 10_000;

/**
 * Background music per map. Kept explicit (rather than derived from id
 * prefixes) so renaming or adding a map forces a conscious choice.
 */
export const MUSIC_BY_MAP: Record<MapId, string> = {
  map_ember_village: "music.village",
  map_gale_village: "music.village",
  map_tide_village: "music.village",
  map_ember_fields: "music.highlands",
  map_gale_highlands: "music.highlands",
  map_tide_highlands: "music.highlands",
  map_valley_of_echoes: "music.valley",
  map_corrupted_forest: "music.forest",
  map_spider_cave: "music.dungeon",
};

/** Returns the music key for a map, falling back to the village theme. */
export function musicKeyForMap(mapId: MapId): string {
  return MUSIC_BY_MAP[mapId] ?? "music.village";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSynth(owner: string, value: unknown): SynthSpec {
  if (!isRecord(value)) {
    throw new Error(`${owner}.synth must be an object`);
  }
  if (typeof value.wave !== "string" || !WAVES.has(value.wave)) {
    throw new Error(
      `${owner}.synth.wave must be one of ${[...WAVES].join(", ")} (got ${String(value.wave)})`,
    );
  }
  if (!isFiniteNumber(value.frequency) || value.frequency <= 0) {
    throw new Error(`${owner}.synth.frequency must be a positive number`);
  }
  if (
    value.endFrequency !== undefined &&
    (!isFiniteNumber(value.endFrequency) || value.endFrequency <= 0)
  ) {
    throw new Error(`${owner}.synth.endFrequency must be a positive number`);
  }
  if (!isFiniteNumber(value.durationMs) || value.durationMs <= 0) {
    throw new Error(`${owner}.synth.durationMs must be a positive number`);
  }
  if (value.durationMs > MAX_DURATION_MS) {
    throw new Error(`${owner}.synth.durationMs must be <= ${MAX_DURATION_MS}`);
  }
  if (!isFiniteNumber(value.volume) || value.volume < 0 || value.volume > 1) {
    throw new Error(`${owner}.synth.volume must be between 0 and 1`);
  }
  if (value.decay !== undefined && (!isFiniteNumber(value.decay) || value.decay < 0)) {
    throw new Error(`${owner}.synth.decay must be >= 0`);
  }
  let notes: number[] | undefined;
  if (value.notes !== undefined) {
    if (!Array.isArray(value.notes) || value.notes.length === 0) {
      throw new Error(`${owner}.synth.notes must be a non-empty array`);
    }
    notes = value.notes.map((note, index) => {
      if (!isFiniteNumber(note) || note <= 0) {
        throw new Error(`${owner}.synth.notes[${index}] must be a positive number`);
      }
      return note;
    });
  }
  return {
    wave: value.wave as SynthWave,
    frequency: value.frequency,
    ...(value.endFrequency !== undefined ? { endFrequency: value.endFrequency } : {}),
    ...(notes ? { notes } : {}),
    durationMs: value.durationMs,
    volume: value.volume,
    ...(value.decay !== undefined ? { decay: value.decay } : {}),
  };
}

function parseEntry(key: string, value: unknown): AudioEntry {
  if (!isRecord(value)) {
    throw new Error(`audio "${key}" must be an object`);
  }
  if (typeof value.path !== "string" || value.path.length === 0) {
    throw new Error(`audio "${key}" needs a non-empty string "path"`);
  }
  if (
    value.volume !== undefined &&
    (!isFiniteNumber(value.volume) || value.volume < 0 || value.volume > 1)
  ) {
    throw new Error(`audio "${key}".volume must be between 0 and 1`);
  }
  if (
    value.maxVoices !== undefined &&
    (typeof value.maxVoices !== "number" ||
      !Number.isInteger(value.maxVoices) ||
      value.maxVoices < 1 ||
      value.maxVoices > MAX_VOICES)
  ) {
    throw new Error(`audio "${key}".maxVoices must be an integer between 1 and ${MAX_VOICES}`);
  }
  if (
    value.minIntervalMs !== undefined &&
    (!isFiniteNumber(value.minIntervalMs) ||
      value.minIntervalMs < 0 ||
      value.minIntervalMs > MAX_THROTTLE_MS)
  ) {
    throw new Error(`audio "${key}".minIntervalMs must be between 0 and ${MAX_THROTTLE_MS}`);
  }
  return {
    path: value.path,
    synth: parseSynth(`audio "${key}"`, value.synth),
    ...(value.volume !== undefined ? { volume: value.volume } : {}),
    ...(value.maxVoices !== undefined ? { maxVoices: value.maxVoices } : {}),
    ...(value.minIntervalMs !== undefined ? { minIntervalMs: value.minIntervalMs } : {}),
  };
}

function parseSection(
  value: unknown,
  section: "sounds" | "music",
  prefix: string,
): Record<string, AudioEntry> {
  if (!isRecord(value)) {
    throw new Error(`audio manifest "${section}" must be an object`);
  }
  const entries: Record<string, AudioEntry> = {};
  const errors: string[] = [];
  for (const [key, rawEntry] of Object.entries(value)) {
    try {
      if (!key.startsWith(prefix)) {
        throw new Error(`audio "${key}" in "${section}" must start with "${prefix}"`);
      }
      entries[key] = parseEntry(key, rawEntry);
    } catch (error) {
      errors.push(String(error));
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid audio "${section}":\n${errors.join("\n")}`);
  }
  return entries;
}

/** Strict shape validation; throws a readable list of errors. */
export function parseAudioManifest(value: unknown): AudioManifest {
  if (!isRecord(value)) {
    throw new Error("audio manifest root must be an object");
  }
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) {
    throw new Error('audio manifest "version" must be a positive integer');
  }
  const sounds = parseSection(value.sounds, "sounds", "sfx.");
  const music = parseSection(value.music, "music", "music.");
  const missing = MAP_IDS.map((mapId) => MUSIC_BY_MAP[mapId]).filter((key) => !(key in music));
  if (missing.length > 0) {
    throw new Error(
      `audio manifest is missing music for maps: ${[...new Set(missing)].join(", ")}`,
    );
  }
  return { version: value.version, sounds, music };
}

export async function fetchAudioManifest(
  url: string = DEFAULT_AUDIO_MANIFEST_URL,
): Promise<AudioManifest> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    throw new Error(`${url} is not valid JSON`);
  }
  return parseAudioManifest(value);
}
