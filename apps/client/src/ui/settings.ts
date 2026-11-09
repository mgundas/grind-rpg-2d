/**
 * Persisted client settings (GAME_DESIGN.md §10.4): volumes, display
 * toggles, camera zoom and key bindings. Stored under one localStorage key;
 * corrupt or older values fall back to defaults field by field.
 */

import {
  DEFAULT_KEYBINDS,
  parseKeybinds,
  type Keybinds,
} from "./keybinds";

export type ZoomLevel = 1 | 2 | 3;

export interface GameSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  showNames: boolean;
  showDamageNumbers: boolean;
  weatherEnabled: boolean;
  dayNightEnabled: boolean;
  screenShakeEnabled: boolean;
  zoom: ZoomLevel;
  keybinds: Keybinds;
}

export const SETTINGS_STORAGE_KEY = "jt.settings.v1";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function defaultSettings(): GameSettings {
  return {
    masterVolume: 0.8,
    musicVolume: 0.6,
    sfxVolume: 0.9,
    muted: false,
    showNames: true,
    showDamageNumbers: true,
    weatherEnabled: true,
    dayNightEnabled: true,
    screenShakeEnabled: !prefersReducedMotion(),
    zoom: 2,
    keybinds: { ...DEFAULT_KEYBINDS },
  };
}

function clamp01(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Parses a stored settings JSON string; never throws. */
export function parseSettings(raw: string | null): GameSettings {
  const defaults = defaultSettings();
  if (!raw) {
    return defaults;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return defaults;
  }
  const record = parsed as Record<string, unknown>;
  const zoom = record.zoom === 1 || record.zoom === 3 ? record.zoom : defaults.zoom;
  return {
    masterVolume: clamp01(record.masterVolume, defaults.masterVolume),
    musicVolume: clamp01(record.musicVolume, defaults.musicVolume),
    sfxVolume: clamp01(record.sfxVolume, defaults.sfxVolume),
    muted: bool(record.muted, defaults.muted),
    showNames: bool(record.showNames, defaults.showNames),
    showDamageNumbers: bool(record.showDamageNumbers, defaults.showDamageNumbers),
    weatherEnabled: bool(record.weatherEnabled, defaults.weatherEnabled),
    dayNightEnabled: bool(record.dayNightEnabled, defaults.dayNightEnabled),
    screenShakeEnabled: bool(record.screenShakeEnabled, defaults.screenShakeEnabled),
    zoom,
    keybinds: parseKeybinds(record.keybinds),
  };
}

export function loadSettings(): GameSettings {
  if (typeof localStorage === "undefined") {
    return defaultSettings();
  }
  try {
    return parseSettings(localStorage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: GameSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable; settings still apply for this session.
  }
}
