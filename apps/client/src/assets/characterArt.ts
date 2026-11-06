import type { CharacterAppearance } from "@jadethrone/shared";
import { getClass } from "@jadethrone/data/classes";

/**
 * Procedural layered character art (GAME_DESIGN.md §2.1, §4.1). The same
 * painter backs the in-world texture and the character-select preview, so a
 * placeholder always matches what other players see. No external assets.
 */
export const CHARACTER_FRAME_SIZE = 64;

/** Cosmetic hair palette, indexed by the persisted `hairColor`. */
export const HAIR_COLORS = ["#2b1d14", "#8a5a2b", "#d9c18a"] as const;

const SKIN = { male: "#c89b6a", female: "#dcae7e" } as const;
const OUTLINE = "rgba(10, 14, 12, 0.55)";

export type CharacterLook = CharacterAppearance & {
  /** Equipped visual layers, e.g. `weapon.sword.t2`; empty/undefined = none. */
  weaponLayer?: string;
  armorLayer?: string;
  helmetLayer?: string;
  shieldLayer?: string;
};

/** Stable texture key; identical appearance + equipment reuses one texture. */
export function characterTextureKey(look: CharacterLook): string {
  const layer = (value: string | undefined) => (value && value.length > 0 ? value : "-");
  return [
    "char.gen",
    look.classId,
    look.gender,
    look.hairStyle,
    look.hairColor,
    layer(look.weaponLayer),
    layer(look.armorLayer),
    layer(look.helmetLayer),
    layer(look.shieldLayer),
  ].join(".");
}

function layerTier(layer: string | undefined): number {
  const match = layer?.match(/t(\d)$/);
  return match ? Number(match[1]) : 1;
}

function weaponColor(layer: string | undefined): string {
  if (!layer) {
    return "#b8bcc2";
  }
  if (layer.includes("dagger")) return "#9aa7b8";
  if (layer.includes("bell")) return "#d8b44a";
  if (layer.includes("hex")) return "#9b6bd1";
  return "#c7ced6";
}

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

function hairColorFor(index: number): string {
  return HAIR_COLORS[index] ?? HAIR_COLORS[0]!;
}

/**
 * Draw one 64×64 LPC-sized frame at (0,0). Layers, bottom to top:
 * legs → torso/class outfit → belt → arms → head → hair.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  look: CharacterLook,
  size = CHARACTER_FRAME_SIZE,
): void {
  const info = getClass(look.classId);
  const pants = info.colors.pants;
  const outfit = info.colors.outfit;
  const trim = info.colors.trim;
  const skin = SKIN[look.gender];
  const female = look.gender === "female";
  const shoulder = female ? 21 : 24;
  const hip = female ? 20 : 22;

  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;

  // Legs / boots.
  ctx.fillStyle = pants;
  ctx.fillRect(28, 40, 5, 14);
  ctx.fillRect(35, 40, 5, 14);
  ctx.fillStyle = shade(pants, 0.6);
  ctx.fillRect(27, 52, 7, 4);
  ctx.fillRect(34, 52, 7, 4);

  // Torso.
  ctx.beginPath();
  ctx.roundRect(32 - hip / 2, 22, hip, 22, 4);
  ctx.fillStyle = outfit;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Shoulders + arms.
  ctx.fillStyle = shade(outfit, 0.9);
  ctx.beginPath();
  ctx.roundRect(32 - shoulder / 2 - 2, 22, 5, 18, 2.5);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(32 + shoulder / 2 - 3, 22, 5, 18, 2.5);
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.fillRect(32 - shoulder / 2 - 2, 38, 5, 4);
  ctx.fillRect(32 + shoulder / 2 - 3, 38, 5, 4);

  // Belt/class trim.
  ctx.fillStyle = trim;
  ctx.fillRect(32 - hip / 2, 39, hip, 3);

  // Equipped armour: a brighter chest plate with shoulder pads.
  if (look.armorLayer) {
    const tier = layerTier(look.armorLayer);
    const plate = shade(outfit, 1.05 + tier * 0.04);
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.roundRect(32 - hip / 2 + 1, 23, hip - 2, 16, 4);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = shade(plate, 0.88);
    ctx.fillRect(32 - shoulder / 2 - 3, 21, 6, 7);
    ctx.fillRect(32 + shoulder / 2 - 3, 21, 6, 7);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(32 - hip / 2 + 3, 25, 3, 10);
  }

  // Off-hand shield.
  if (look.shieldLayer) {
    const tier = layerTier(look.shieldLayer);
    const shieldColor = shade("#8a6b4a", 0.9 + tier * 0.06);
    ctx.fillStyle = shieldColor;
    ctx.beginPath();
    ctx.roundRect(32 - shoulder / 2 - 7, 27, 8, 14, 3);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = shade(shieldColor, 0.65);
    ctx.fillRect(32 - shoulder / 2 - 4, 29, 2, 10);
  }

  // Weapon in the right hand.
  if (look.weaponLayer) {
    const tier = layerTier(look.weaponLayer);
    const blade = weaponColor(look.weaponLayer);
    const length = look.weaponLayer.includes("dagger") ? 10 : 16 + tier;
    ctx.strokeStyle = "#2a2420";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(32 + shoulder / 2 + 1, 44);
    ctx.lineTo(32 + shoulder / 2 + 1, 38);
    ctx.stroke();
    ctx.strokeStyle = blade;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(32 + shoulder / 2 + 1, 39);
    ctx.lineTo(32 + shoulder / 2 + 1, 39 - length);
    ctx.stroke();
    ctx.fillStyle = shade(blade, 0.7);
    ctx.fillRect(32 + shoulder / 2 - 2, 38, 7, 2);
  }

  // Head.
  ctx.beginPath();
  ctx.roundRect(32 - 7, 8, 14, 14, 5);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Eyes (cosmetic; 4 directions are still one placeholder frame + arrow).
  ctx.fillStyle = "#20211d";
  ctx.fillRect(28, 14, 2, 2);
  ctx.fillRect(34, 14, 2, 2);

  // Hair layers.
  const hair = hairColorFor(look.hairColor);
  ctx.fillStyle = hair;
  switch (look.hairStyle) {
    case 1:
      // Long hair: cap plus side locks.
      ctx.beginPath();
      ctx.roundRect(24, 5, 16, 9, 5);
      ctx.fill();
      ctx.fillRect(24, 9, 3, 13);
      ctx.fillRect(37, 9, 3, 13);
      break;
    case 2:
      // Top knot.
      ctx.beginPath();
      ctx.arc(32, 5, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(25, 6, 14, 7, 4);
      ctx.fill();
      break;
    default:
      // Short crop.
      ctx.beginPath();
      ctx.roundRect(25, 5, 14, 7, 4);
      ctx.fill();
      ctx.fillRect(25, 8, 2, 5);
      ctx.fillRect(37, 8, 2, 5);
      break;
  }
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(25.5, 5.5, 13, 6);

  // Helmet on top of the hair.
  if (look.helmetLayer) {
    const tier = layerTier(look.helmetLayer);
    const metal = shade("#8a8f98", 0.9 + tier * 0.06);
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.roundRect(23, 4, 18, 9, 5);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = shade(metal, 0.72);
    ctx.fillRect(23, 11, 18, 2);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(26, 6, 5, 2);
  }
}

/** Draw the composite into a fresh canvas (used by the React preview). */
export function drawCharacterToCanvas(canvas: HTMLCanvasElement, look: CharacterLook): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const frame = document.createElement("canvas");
  frame.width = CHARACTER_FRAME_SIZE;
  frame.height = CHARACTER_FRAME_SIZE;
  const frameCtx = frame.getContext("2d");
  if (!frameCtx) {
    return;
  }
  drawCharacter(frameCtx, look);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
}
