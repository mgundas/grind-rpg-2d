import { z } from "zod";
import { MAP_IDS, type MapId } from "@jadethrone/shared";
import { hasDropTable } from "./dropTables";
import { hasMonster } from "./monsters";
import raw from "../stones.json";

/**
 * Spirit stone profiles (GAME_DESIGN.md §6.2). Stones are stationary, high-HP
 * PvE targets tied to a map's `stone_zone`; the room spawns up to `maxPerZone`
 * and respawns them 3–5 minutes after destruction.
 */
const stoneSchema = z
  .object({
    id: z.string().min(1).max(64),
    zoneId: z.string().min(1).max(64),
    mapId: z.enum(MAP_IDS),
    name: z.string().min(1).max(64),
    level: z.number().int().min(1).max(99),
    hp: z.number().int().min(1).max(4_000_000),
    defense: z.number().min(0).max(500),
    xp: z.number().int().min(0),
    goldMin: z.number().int().min(0),
    goldMax: z.number().int().min(0),
    dropTableId: z.string().min(1).max(64),
    maxPerZone: z.number().int().min(1).max(3),
    respawnMinMs: z.number().int().min(60_000).max(3_600_000),
    respawnMaxMs: z.number().int().min(60_000).max(3_600_000),
    waveTriggers: z.array(z.number().int().min(1).max(99)).length(4),
    waveMin: z.number().int().min(1).max(20),
    waveMax: z.number().int().min(1).max(20),
    waveMonsters: z.array(z.string().min(1).max(64)).min(1),
    spriteKey: z.string().min(1).max(128),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict()
  .superRefine((stone, ctx) => {
    if (stone.goldMax < stone.goldMin) {
      ctx.addIssue({ code: "custom", message: `${stone.id}: goldMax below goldMin` });
    }
    if (stone.respawnMaxMs < stone.respawnMinMs) {
      ctx.addIssue({ code: "custom", message: `${stone.id}: respawnMax below respawnMin` });
    }
    if (stone.waveMax < stone.waveMin) {
      ctx.addIssue({ code: "custom", message: `${stone.id}: waveMax below waveMin` });
    }
    for (let index = 1; index < stone.waveTriggers.length; index++) {
      if (stone.waveTriggers[index]! >= stone.waveTriggers[index - 1]!) {
        ctx.addIssue({ code: "custom", message: `${stone.id}: waveTriggers must descend` });
        break;
      }
    }
    for (const monsterId of stone.waveMonsters) {
      if (!hasMonster(monsterId)) {
        ctx.addIssue({ code: "custom", message: `${stone.id}: unknown wave monster ${monsterId}` });
      }
    }
    if (!hasDropTable(stone.dropTableId)) {
      ctx.addIssue({
        code: "custom",
        message: `${stone.id}: unknown drop table ${stone.dropTableId}`,
      });
    }
  });

const stonesFileSchema = z
  .object({
    version: z.literal(1),
    stones: z.array(stoneSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    const zones = new Set<string>();
    for (const stone of file.stones) {
      if (ids.has(stone.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate stone id "${stone.id}"` });
      }
      if (zones.has(stone.zoneId)) {
        ctx.addIssue({ code: "custom", message: `duplicate stone zone "${stone.zoneId}"` });
      }
      ids.add(stone.id);
      zones.add(stone.zoneId);
    }
  });

const parsed = stonesFileSchema.parse(raw);

export interface StoneInfo {
  id: string;
  zoneId: string;
  mapId: MapId;
  name: string;
  level: number;
  hp: number;
  defense: number;
  xp: number;
  goldMin: number;
  goldMax: number;
  dropTableId: string;
  maxPerZone: number;
  respawnMinMs: number;
  respawnMaxMs: number;
  waveTriggers: number[];
  waveMin: number;
  waveMax: number;
  waveMonsters: string[];
  spriteKey: string;
  color: string;
}

export const STONES: readonly StoneInfo[] = parsed.stones;

const byId = new Map(STONES.map((stone) => [stone.id, stone]));
const byZone = new Map(STONES.map((stone) => [stone.zoneId, stone]));

export function hasStone(id: string): boolean {
  return byId.has(id);
}

export function getStone(id: string): StoneInfo {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown stone "${id}"`);
  }
  return found;
}

export function getStoneForZone(zoneId: string): StoneInfo | undefined {
  return byZone.get(zoneId);
}
