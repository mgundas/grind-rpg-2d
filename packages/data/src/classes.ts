import { z } from "zod";
import { CLASS_IDS, type ClassId } from "@jadethrone/shared";
import raw from "../classes.json";

/**
 * Class balance/design data (GAME_DESIGN.md §4.2). Validated at import so a
 * malformed JSON file fails loudly on server boot and in the client bundle
 * instead of producing a half-playable character.
 *
 * Import through `@jadethrone/data/classes` (not the package root) because the
 * root also exports the Node-only map generator.
 */
const statsSchema = z.object({
  vit: z.number().int().min(0).max(90),
  int: z.number().int().min(0).max(90),
  str: z.number().int().min(0).max(90),
  dex: z.number().int().min(0).max(90),
});

const doctrineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
});

const attackSchema = z.object({
  rangePx: z.number().positive(),
  cooldownMs: z.number().int().min(200),
  maxTargets: z.number().int().min(1).max(20),
});

const classSchema = z.object({
  id: z.enum(CLASS_IDS),
  name: z.string().min(1),
  description: z.string().min(1),
  weapons: z.array(z.string().min(1)).min(1),
  baseHp: z.number().int().positive(),
  baseMp: z.number().int().positive(),
  attack: attackSchema,
  stats: statsSchema,
  colors: z.object({
    outfit: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    trim: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    pants: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  doctrines: z.array(doctrineSchema).length(2),
});

const classesFileSchema = z.object({
  version: z.literal(1),
  classes: z.array(classSchema).length(CLASS_IDS.length),
});

const parsed = classesFileSchema.parse(raw);

export interface DoctrineInfo {
  id: string;
  name: string;
  description: string;
}

export interface ClassAttackProfile {
  rangePx: number;
  cooldownMs: number;
  maxTargets: number;
}

export interface ClassInfo {
  id: ClassId;
  name: string;
  description: string;
  weapons: string[];
  baseHp: number;
  baseMp: number;
  attack: ClassAttackProfile;
  stats: { vit: number; int: number; str: number; dex: number };
  colors: { outfit: string; trim: string; pants: string };
  doctrines: DoctrineInfo[];
}

export const CLASSES: readonly ClassInfo[] = parsed.classes;

export function getClass(id: ClassId): ClassInfo {
  const found = CLASSES.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`unknown class "${id}"`);
  }
  return found;
}
