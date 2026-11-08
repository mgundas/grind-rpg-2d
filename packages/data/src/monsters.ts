import { z } from "zod";
import raw from "../monsters.json";

/**
 * Monster balance and behaviour data (GAME_DESIGN.md §6.1). Validated at import
 * so a malformed file fails at boot/bundle time. Phase 3 does not roll drops;
 * `dropTableId` stays nullable until Phase 4 creates drop tables.
 */
const monsterSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, "monster ids are lower_snake_case"),
    name: z.string().min(1).max(40),
    level: z.number().int().min(1).max(99),
    hp: z.number().int().positive(),
    attack: z.number().int().nonnegative(),
    defense: z.number().int().nonnegative(),
    dex: z.number().int().nonnegative(),
    moveSpeed: z.number().positive(),
    attackRange: z.number().positive(),
    attackCooldownMs: z.number().int().min(200),
    aggroType: z.enum(["passive", "aggressive"]),
    aggroRange: z.number().positive(),
    leashRange: z.number().positive(),
    xp: z.number().int().nonnegative(),
    goldMin: z.number().int().nonnegative(),
    goldMax: z.number().int().nonnegative(),
    dropTableId: z.string().min(1).nullable(),
    spriteKey: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    size: z.enum(["small", "medium", "large"]),
    bonusCategory: z.enum(["animal", "spirit", "humanoid"]),
    isBoss: z.boolean(),
  })
  .refine((monster) => monster.goldMax >= monster.goldMin, {
    message: "goldMax must be >= goldMin",
    path: ["goldMax"],
  })
  .refine((monster) => monster.leashRange >= monster.aggroRange, {
    message: "leashRange must be >= aggroRange",
    path: ["leashRange"],
  });

const monstersFileSchema = z
  .object({
    version: z.literal(1),
    monsters: z.array(monsterSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    for (const [index, monster] of file.monsters.entries()) {
      if (ids.has(monster.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate monster id "${monster.id}"`,
          path: ["monsters", index, "id"],
        });
      }
      ids.add(monster.id);
    }
  });

export type MonsterAggroType = "passive" | "aggressive";
export type MonsterSize = "small" | "medium" | "large";
export type MonsterBonusCategory = "animal" | "spirit" | "humanoid";

export interface MonsterInfo {
  id: string;
  name: string;
  level: number;
  hp: number;
  attack: number;
  defense: number;
  dex: number;
  moveSpeed: number;
  attackRange: number;
  attackCooldownMs: number;
  aggroType: MonsterAggroType;
  aggroRange: number;
  leashRange: number;
  xp: number;
  goldMin: number;
  goldMax: number;
  dropTableId: string | null;
  spriteKey: string;
  color: string;
  size: MonsterSize;
  bonusCategory: MonsterBonusCategory;
  isBoss: boolean;
}

/** Build and validate monsters from raw JSON (base or merged). */
export function buildMonsters(rawJson: unknown): readonly MonsterInfo[] {
  return monstersFileSchema.parse(rawJson).monsters;
}

export const MONSTERS: readonly MonsterInfo[] = buildMonsters(raw);

const byId = new Map(MONSTERS.map((monster) => [monster.id, monster]));

export function hasMonster(id: string): boolean {
  return byId.has(id);
}

export function getMonster(id: string): MonsterInfo {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown monster "${id}"`);
  }
  return found;
}
