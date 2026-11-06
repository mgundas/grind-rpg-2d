import Phaser from "phaser";
import {
  mulberry32,
  RARITY_COLORS,
  seedFromString,
  TILE_SIZE,
  type Rarity,
} from "@jadethrone/shared";
import type { PlaceholderSpec } from "./manifest";

/**
 * Procedural placeholder textures (GAME_DESIGN.md §2.1). Everything the game
 * expects but no real art exists for gets one of these under the SAME
 * texture key, so game code never knows whether art is real.
 *
 * All randomness derives from the asset key via the shared seeded RNG —
 * the same key always produces the identical texture.
 */

/** 64x64: the Universal LPC frame size (see ASSETS.md). */
const CHAR_FRAME_SIZE = 64;

const TILE_PALETTE: Record<string, string> = {
  grass: "#4e7a3a",
  dirt: "#8a6b4a",
  stone: "#7d7f82",
  water: "#3b6ea5",
  wall: "#53484f",
};

const DEFAULT_TILE_COLOR = "#9a8f80";

function shade(hex: string, factor: number): string {
  const normalized = hex.replace("#", "");
  const int = Number.parseInt(normalized, 16);
  if (Number.isNaN(int) || normalized.length !== 6) {
    return hex;
  }
  const r = Math.min(255, Math.max(0, Math.round(((int >> 16) & 0xff) * factor)));
  const g = Math.min(255, Math.max(0, Math.round(((int >> 8) & 0xff) * factor)));
  const b = Math.min(255, Math.max(0, Math.round((int & 0xff) * factor)));
  return `rgb(${r}, ${g}, ${b})`;
}

function rarityColor(rarity: string | undefined): string {
  const key = (rarity as Rarity | undefined) ?? "common";
  return RARITY_COLORS[key] ?? RARITY_COLORS.common;
}

/**
 * Register a canvas as a texture under `key` (replacing anything the loader
 * left behind for a failed file). Returns true when the texture exists.
 */
function registerCanvas(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): boolean {
  if (scene.textures.exists(key)) {
    scene.textures.remove(key);
  }
  return scene.textures.addCanvas(key, canvas) !== null;
}

function addNoise(ctx: CanvasRenderingContext2D, seed: string, size: number): void {
  const rng = mulberry32(seedFromString(seed));
  for (let i = 0; i < 40; i++) {
    const dark = rng() < 0.5;
    ctx.fillStyle = dark ? "rgba(0, 0, 0, 0.10)" : "rgba(255, 255, 255, 0.08)";
    const x = Math.floor(rng() * (size - 2));
    const y = Math.floor(rng() * (size - 2));
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  kind: string,
  seed: string,
  offsetX: number,
): void {
  const base = TILE_PALETTE[kind] ?? DEFAULT_TILE_COLOR;
  ctx.fillStyle = base;
  ctx.fillRect(offsetX, 0, TILE_SIZE, TILE_SIZE);
  addNoise(ctx, `${seed}:${kind}`, TILE_SIZE);
  // Slightly darker bottom edge so tiles are individually readable at zoom 2.
  ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
  ctx.fillRect(offsetX, TILE_SIZE - 2, TILE_SIZE, 2);
}

function drawCharacter(ctx: CanvasRenderingContext2D, color: string, seed: string): void {
  const outline = shade(color, 0.55);
  // Body capsule, feet at the lower third so an origin of (0.5, ~0.85) works.
  ctx.beginPath();
  ctx.roundRect(24, 16, 16, 40, 8);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = outline;
  ctx.stroke();
  // Head hint.
  ctx.beginPath();
  ctx.roundRect(26, 6, 12, 12, 5);
  ctx.fillStyle = shade(color, 0.9);
  ctx.fill();
  ctx.stroke();
  addNoise(ctx, `${seed}:char`, CHAR_FRAME_SIZE);
}

function drawIcon(ctx: CanvasRenderingContext2D, frame: string, label: string, seed: string): void {
  const outline = shade(frame, 0.5);
  ctx.beginPath();
  ctx.roundRect(4, 4, 56, 56, 10);
  ctx.fillStyle = frame;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.font = "bold 24px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label.slice(0, 2).toUpperCase(), 32, 34);
  addNoise(ctx, `${seed}:icon`, CHAR_FRAME_SIZE);
}

/** Generate the placeholder for one manifest entry. Returns true on success. */
export function createPlaceholder(
  scene: Phaser.Scene,
  key: string,
  spec: PlaceholderSpec,
): boolean {
  const canvas = document.createElement("canvas");
  switch (spec.kind) {
    case "tileset": {
      const tiles = spec.tiles?.length ? spec.tiles : ["grass"];
      canvas.width = TILE_SIZE * tiles.length;
      canvas.height = TILE_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return false;
      }
      tiles.forEach((kind, index) => {
        drawTile(ctx, kind, `${key}#${index}`, index * TILE_SIZE);
      });
      return registerCanvas(scene, key, canvas);
    }
    case "char":
    case "mob": {
      canvas.width = CHAR_FRAME_SIZE;
      canvas.height = CHAR_FRAME_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return false;
      }
      drawCharacter(ctx, spec.color ?? "#9a8f80", key);
      return registerCanvas(scene, key, canvas);
    }
    case "icon": {
      canvas.width = CHAR_FRAME_SIZE;
      canvas.height = CHAR_FRAME_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return false;
      }
      drawIcon(ctx, rarityColor(spec.rarity), spec.label ?? "??", key);
      return registerCanvas(scene, key, canvas);
    }
    case "portrait": {
      canvas.width = CHAR_FRAME_SIZE;
      canvas.height = CHAR_FRAME_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return false;
      }
      drawIcon(ctx, spec.color ?? "#9a8f80", "Po", key);
      return registerCanvas(scene, key, canvas);
    }
    default: {
      // Exhaustiveness guard: future kinds must be handled above.
      const unknownKind: never = spec.kind;
      void unknownKind;
      return false;
    }
  }
}
