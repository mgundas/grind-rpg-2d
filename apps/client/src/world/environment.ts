import Phaser from "phaser";
import { dayCycleAt } from "@jadethrone/shared";
import type { WeatherKind } from "@jadethrone/data/mapPolicies";
import { useUiStore } from "../ui/store";

const WEATHER_TEXTURE = "fx.weather";
const WEATHER_DEPTH = 5000;

function ensureWeatherTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(WEATHER_TEXTURE)) {
    return;
  }
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.fillStyle(0xffffff, 1);
  graphics.fillRect(0, 0, 3, 3);
  graphics.generateTexture(WEATHER_TEXTURE, 3, 3);
  graphics.destroy();
}

function weatherConfig(
  weather: WeatherKind,
  width: number,
): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
  if (weather === "rain") {
    return {
      x: { min: 0, max: width },
      y: -10,
      lifespan: 1600,
      speedY: { min: 420, max: 620 },
      speedX: { min: -60, max: -20 },
      quantity: 2,
      frequency: 35,
      scaleX: 0.45,
      scaleY: { min: 3, max: 6 },
      alpha: { start: 0.55, end: 0.1 },
      tint: 0x9fc7df,
      blendMode: Phaser.BlendModes.NORMAL,
    };
  }
  return {
    x: { min: 0, max: width },
    y: -12,
    lifespan: 9000,
    speedY: { min: 28, max: 70 },
    speedX: { min: -35, max: 35 },
    quantity: 1,
    frequency: 180,
    scale: { min: 0.5, max: 1.2 },
    rotate: { min: 0, max: 360 },
    alpha: { start: 0.65, end: 0 },
    tint: weather === "leaves" ? 0xc9a227 : 0xffffff,
    blendMode: Phaser.BlendModes.NORMAL,
  };
}

/**
 * Client-only day/night tint and ambient weather. Uses a camera colour matrix
 * (no normal-map dependency) and bounded particle emitters.
 */
export class EnvironmentController {
  private readonly filter: Phaser.Filters.ColorMatrix;
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private lastDarkness = -1;
  private dayNightEnabled = true;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly weather: WeatherKind,
    private readonly viewport: { width: number; height: number },
  ) {
    this.filter = scene.cameras.main.filters.external.addColorMatrix();
  }

  update(now: number): void {
    const state = useUiStore.getState();
    if (this.dayNightEnabled !== state.dayNightEnabled) {
      this.dayNightEnabled = state.dayNightEnabled;
      this.lastDarkness = -1;
      if (!this.dayNightEnabled) {
        this.filter.colorMatrix.reset();
      }
    }
    if (this.dayNightEnabled) {
      const darkness = dayCycleAt(now).darkness;
      if (Math.abs(darkness - this.lastDarkness) > 0.01) {
        this.lastDarkness = darkness;
        this.filter.colorMatrix.reset().brightness(1 - darkness * 0.62);
      }
    }

    const shouldEmit = state.weatherEnabled && this.weather !== "none";
    if (shouldEmit && !this.emitter) {
      this.emitter = this.createEmitter();
    }
    if (this.emitter) {
      if (shouldEmit && !this.emitter.emitting) {
        this.emitter.start();
      } else if (!shouldEmit && this.emitter.emitting) {
        this.emitter.stop();
      }
    }
  }

  destroy(): void {
    this.emitter?.destroy();
    this.emitter = null;
    this.filter.destroy();
  }

  private createEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    ensureWeatherTexture(this.scene);
    const emitter = this.scene.add.particles(
      0,
      0,
      WEATHER_TEXTURE,
      weatherConfig(this.weather, this.viewport.width),
    );
    emitter.setScrollFactor(0);
    emitter.setDepth(WEATHER_DEPTH);
    return emitter;
  }
}
