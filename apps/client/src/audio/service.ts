/**
 * Client audio: one small service over the Web Audio API.
 *
 * - Real files from `assets/audio.json` win; a missing file falls back to the
 *   deterministic synth from `synth.ts`, under the same key.
 * - The context starts suspended; the first pointer/key gesture resumes it
 *   (browser autoplay policy).
 * - Music crossfades on map change; SFX respect per-key voice/throttle limits.
 */

import type { AudioEntry, AudioManifest } from "../assets/audioManifest";
import { renderSynthWav } from "./synth";

export type AudioChannel = "music" | "sfx";

export interface AudioSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.9,
  muted: false,
};

const MUSIC_FADE_SECONDS = 0.5;

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** Volume for a mixer channel, with mute applied to the master only. */
export function volumeForChannel(
  settings: AudioSettings,
  channel: "master" | AudioChannel,
): number {
  if (channel === "master") {
    return settings.muted ? 0 : clampVolume(settings.masterVolume);
  }
  if (channel === "music") {
    return clampVolume(settings.musicVolume);
  }
  return clampVolume(settings.sfxVolume);
}

/**
 * Per-key throttle and polyphony. Kept separate from WebAudio so it can be
 * unit tested and so a key without `maxVoices` defaults to one voice.
 */
export class PlaybackGate {
  private readonly lastStartedAt = new Map<string, number>();
  private readonly active = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  canPlay(key: string, entry: Pick<AudioEntry, "maxVoices" | "minIntervalMs">): boolean {
    const last = this.lastStartedAt.get(key);
    const minInterval = entry.minIntervalMs ?? 0;
    if (last !== undefined && this.now() - last < minInterval) {
      return false;
    }
    return (this.active.get(key) ?? 0) < (entry.maxVoices ?? 1);
  }

  markStarted(key: string): void {
    this.lastStartedAt.set(key, this.now());
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
  }

  markEnded(key: string): void {
    const next = (this.active.get(key) ?? 1) - 1;
    if (next <= 0) {
      this.active.delete(key);
    } else {
      this.active.set(key, next);
    }
  }

  activeVoices(key: string): number {
    return this.active.get(key) ?? 0;
  }
}

export interface AudioServiceOptions {
  createContext?: () => AudioContext | null;
  fetchBytes?: (url: string) => Promise<ArrayBuffer | null>;
  now?: () => number;
  warn?: (message: string) => void;
}

function defaultCreateContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

async function defaultFetchBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export class AudioService {
  private manifest: AudioManifest | null = null;
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly gate: PlaybackGate;
  private readonly options: Required<Pick<AudioServiceOptions, "createContext" | "fetchBytes" | "now" | "warn">>;
  private musicKey: string | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicVoiceGain: GainNode | null = null;
  private musicToken = 0;
  private disposed = false;
  private unlockTarget: EventTarget | null = null;
  private readonly unlockHandler = (): void => {
    void this.resume();
  };

  constructor(options: AudioServiceOptions = {}) {
    this.options = {
      createContext: options.createContext ?? defaultCreateContext,
      fetchBytes: options.fetchBytes ?? defaultFetchBytes,
      now: options.now ?? (() => Date.now()),
      warn: options.warn ?? ((message) => console.warn(message)),
    };
    this.gate = new PlaybackGate(this.options.now);
  }

  setManifest(manifest: AudioManifest): void {
    this.manifest = manifest;
  }

  setSettings(settings: AudioSettings): void {
    this.settings = settings;
    this.applyGains();
  }

  getSettings(): AudioSettings {
    return this.settings;
  }

  /** Attaches one-shot unlock listeners; returns a detach function. */
  attachUnlock(target: EventTarget): () => void {
    if (this.unlockTarget) {
      this.detachUnlock();
    }
    this.unlockTarget = target;
    target.addEventListener("pointerdown", this.unlockHandler);
    target.addEventListener("keydown", this.unlockHandler);
    return () => this.detachUnlock();
  }

  private detachUnlock(): void {
    if (!this.unlockTarget) {
      return;
    }
    this.unlockTarget.removeEventListener("pointerdown", this.unlockHandler);
    this.unlockTarget.removeEventListener("keydown", this.unlockHandler);
    this.unlockTarget = null;
  }

  async resume(): Promise<void> {
    const context = this.ensureContext();
    if (context && context.state !== "running") {
      try {
        await context.resume();
      } catch {
        // A browser may still refuse outside a gesture; the next one retries.
      }
    }
  }

  /** Warms the SFX buffers (music loads on first play). Never throws. */
  async preloadSounds(): Promise<void> {
    if (!this.manifest) {
      return;
    }
    await Promise.all(
      Object.keys(this.manifest.sounds).map((key) => this.loadBuffer(key).catch(() => null)),
    );
  }

  playSfx(key: string): void {
    const entry = this.manifest?.sounds[key];
    if (!entry || this.disposed) {
      return;
    }
    if (!this.gate.canPlay(key, entry)) {
      return;
    }
    const context = this.ensureContext();
    const channel = this.sfxGain;
    if (!context || !channel) {
      return;
    }
    this.gate.markStarted(key);
    void this.loadBuffer(key)
      .then((buffer) => {
        if (!buffer || this.disposed) {
          this.gate.markEnded(key);
          return;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = clampVolume(entry.volume ?? 1);
        source.connect(gain);
        gain.connect(channel);
        source.onended = () => {
          this.gate.markEnded(key);
          gain.disconnect();
        };
        source.start();
      })
      .catch(() => this.gate.markEnded(key));
  }

  playMusic(key: string): void {
    const entry = this.manifest?.music[key];
    if (!entry || this.disposed) {
      return;
    }
    if (this.musicKey === key && this.musicSource) {
      return;
    }
    const context = this.ensureContext();
    const channel = this.musicGain;
    if (!context || !channel) {
      return;
    }
    this.musicKey = key;
    const token = ++this.musicToken;
    void this.loadBuffer(key)
      .then((buffer) => {
        if (!buffer || this.disposed || token !== this.musicToken) {
          return;
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = context.createGain();
        const start = context.currentTime;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(clampVolume(entry.volume ?? 1), start + MUSIC_FADE_SECONDS);
        source.connect(gain);
        gain.connect(channel);
        source.start();

        const previousSource = this.musicSource;
        const previousGain = this.musicVoiceGain;
        if (previousSource && previousGain) {
          previousGain.gain.cancelScheduledValues(start);
          previousGain.gain.setValueAtTime(previousGain.gain.value, start);
          previousGain.gain.linearRampToValueAtTime(0, start + MUSIC_FADE_SECONDS);
          try {
            previousSource.stop(start + MUSIC_FADE_SECONDS + 0.1);
          } catch {
            // Already stopped.
          }
        }
        this.musicSource = source;
        this.musicVoiceGain = gain;
      })
      .catch(() => undefined);
  }

  stopMusic(): void {
    this.musicToken++;
    this.musicKey = null;
    const context = this.context;
    const source = this.musicSource;
    const gain = this.musicVoiceGain;
    this.musicSource = null;
    this.musicVoiceGain = null;
    if (!context || !source) {
      return;
    }
    const now = context.currentTime;
    if (gain) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.25);
    }
    try {
      source.stop(now + 0.3);
    } catch {
      // Already stopped.
    }
  }

  /** Exposed for tests and the Settings window mute preview. */
  isReady(): boolean {
    return this.context !== null;
  }

  dispose(): void {
    this.disposed = true;
    this.detachUnlock();
    this.stopMusic();
    for (const promise of this.buffers.values()) {
      void promise.catch(() => null);
    }
    this.buffers.clear();
    const context = this.context;
    this.context = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
  }

  private applyGains(): void {
    if (this.masterGain) {
      this.masterGain.gain.value = volumeForChannel(this.settings, "master");
    }
    if (this.musicGain) {
      this.musicGain.gain.value = volumeForChannel(this.settings, "music");
    }
    if (this.sfxGain) {
      this.sfxGain.gain.value = volumeForChannel(this.settings, "sfx");
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) {
      return this.context;
    }
    const context = this.options.createContext();
    if (!context) {
      return null;
    }
    this.context = context;
    this.masterGain = context.createGain();
    this.masterGain.connect(context.destination);
    this.musicGain = context.createGain();
    this.musicGain.connect(this.masterGain);
    this.sfxGain = context.createGain();
    this.sfxGain.connect(this.masterGain);
    this.applyGains();
    return context;
  }

  private entryFor(key: string): AudioEntry | null {
    if (!this.manifest) {
      return null;
    }
    return this.manifest.sounds[key] ?? this.manifest.music[key] ?? null;
  }

  private loadBuffer(key: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(key);
    if (cached) {
      return cached;
    }
    const promise = this.decodeEntry(key).catch((error: unknown) => {
      this.options.warn(`audio "${key}" could not be decoded: ${String(error)}`);
      return null;
    });
    this.buffers.set(key, promise);
    return promise;
  }

  private async decodeEntry(key: string): Promise<AudioBuffer | null> {
    const entry = this.entryFor(key);
    if (!entry) {
      return null;
    }
    const context = this.ensureContext();
    if (!context) {
      return null;
    }
    const fileBytes = await this.options.fetchBytes(`/assets/${entry.path}`);
    if (fileBytes) {
      try {
        return await context.decodeAudioData(fileBytes);
      } catch (error) {
        this.options.warn(
          `audio "${key}" file failed to decode; using the synth placeholder (${String(error)})`,
        );
      }
    }
    const samples = renderSynthWav(entry.synth, context.sampleRate);
    return context.decodeAudioData(toArrayBuffer(samples));
  }
}

/** One service per page; scenes attach/detach their own unlock listeners. */
export const audio = new AudioService();
