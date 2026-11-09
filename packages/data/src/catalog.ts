import type {
  ClassId,
  GameDataDataset,
  ItemType,
  Rarity,
} from "@jadethrone/shared";
import { ZodError } from "zod";
import rawBonusFile from "../bonuses.json";
import rawDropTables from "../dropTables.json";
import rawItems from "../items.json";
import rawMonsters from "../monsters.json";
import rawNpcs from "../npcs.json";
import rawShops from "../shops.json";
import rawSkills from "../skills.json";
import rawSpawnGroups from "../spawnGroups.json";
import rawStones from "../stones.json";
import rawUpgrades from "../upgrades.json";
import { buildBonuses, type BonusDefinition } from "./bonuses";
import { buildDropTables, type DropTable } from "./dropTables";
import { buildItems, type ItemDefinition } from "./items";
import { buildMonsters, type MonsterInfo } from "./monsters";
import { buildNpcs, type NpcInfo } from "./npcs";
import { buildShops, type ShopInfo } from "./shops";
import { buildSkills, type SkillInfo } from "./skills";
import { buildSpawnGroups, type SpawnGroupInfo } from "./spawnGroups";
import { buildStones, type StoneInfo } from "./stones";
import { buildUpgrades, type UpgradeStep } from "./upgrades";

/** Raw per-entry arrays; overrides replace or append one entry at a time. */
export interface GameDataEntries {
  items: readonly unknown[];
  monsters: readonly unknown[];
  dropTables: readonly unknown[];
  shops: readonly unknown[];
  spawnGroups: readonly unknown[];
  npcs: readonly unknown[];
  skills: readonly unknown[];
  stones: readonly unknown[];
  upgrades: readonly unknown[];
  bonuses: readonly unknown[];
}

export interface GameDataOverrideInput {
  dataset: GameDataDataset;
  entryId: string;
  payload: unknown;
}

export interface GameDataValidationIssue {
  path: string;
  message: string;
}

export class GameDataValidationError extends Error {
  readonly dataset: GameDataDataset;
  readonly issues: ReadonlyArray<GameDataValidationIssue>;

  constructor(
    dataset: GameDataDataset,
    issues: ReadonlyArray<GameDataValidationIssue>,
    message = "Invalid game data.",
  ) {
    super(message);
    this.name = "GameDataValidationError";
    this.dataset = dataset;
    this.issues = issues;
  }
}

function wrapValidation(dataset: GameDataDataset, task: () => void): void {
  try {
    task();
  } catch (error) {
    if (error instanceof ZodError) {
      throw new GameDataValidationError(
        dataset,
        error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }
    // Cross-reference checks throw plain Errors; keep the catalog error shape so
    // admin writes surface a 400 with the offending dataset.
    throw new GameDataValidationError(dataset, [
      { path: "", message: error instanceof Error ? error.message : "invalid data" },
    ]);
  }
}

export const BASE_GAME_DATA: GameDataEntries = {
  items: rawItems.items,
  monsters: rawMonsters.monsters,
  dropTables: rawDropTables.dropTables,
  shops: rawShops.shops,
  spawnGroups: rawSpawnGroups.groups,
  npcs: rawNpcs.npcs,
  skills: rawSkills.skills,
  stones: rawStones.stones,
  upgrades: rawUpgrades.steps,
  bonuses: rawBonusFile.bonuses,
};

export interface CatalogLookup {
  hasItem(id: string): boolean;
  getItem(id: string): ItemDefinition;
  findItem(id: string): ItemDefinition | undefined;
  hasMonster(id: string): boolean;
  getMonster(id: string): MonsterInfo;
  findMonster(id: string): MonsterInfo | undefined;
  hasDropTable(id: string): boolean;
  getDropTable(id: string): DropTable;
  findDropTable(id: string): DropTable | undefined;
  hasShop(id: string): boolean;
  getShop(id: string): ShopInfo;
  findShop(id: string): ShopInfo | undefined;
  hasNpc(id: string): boolean;
  getNpc(id: string): NpcInfo;
  findNpc(id: string): NpcInfo | undefined;
  hasSkill(id: string): boolean;
  getSkill(id: string): SkillInfo;
  findSkill(id: string): SkillInfo | undefined;
  hasStone(id: string): boolean;
  getStone(id: string): StoneInfo;
  findStone(id: string): StoneInfo | undefined;
  getStoneForZone(zoneId: string): StoneInfo | undefined;
  hasSpawnGroup(id: string): boolean;
  getSpawnGroup(id: string): SpawnGroupInfo;
  findSpawnGroup(id: string): SpawnGroupInfo | undefined;
  getUpgradeStep(level: number): UpgradeStep | undefined;
  readonly maxUpgradeLevel: number;
  getBonusDefinition(type: string): BonusDefinition | undefined;
  bonusesForItemType(itemType: ItemType): BonusDefinition[];
  skillsForDoctrine(classId: ClassId, doctrineId: string): SkillInfo[];
}

export interface GameDataCatalog extends CatalogLookup {
  readonly version: number;
  readonly items: readonly ItemDefinition[];
  readonly monsters: readonly MonsterInfo[];
  readonly dropTables: readonly DropTable[];
  readonly shops: readonly ShopInfo[];
  readonly npcs: readonly NpcInfo[];
  readonly skills: readonly SkillInfo[];
  readonly stones: readonly StoneInfo[];
  readonly spawnGroups: readonly SpawnGroupInfo[];
  readonly upgradeSteps: readonly UpgradeStep[];
  readonly maxUpgradeLevel: number;
  readonly bonusPool: readonly BonusDefinition[];
}

function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function requireFrom<T>(map: Map<string, T>, id: string, kind: string): T {
  const found = map.get(id);
  if (!found) {
    throw new Error(`unknown ${kind} "${id}"`);
  }
  return found;
}

/** Build a fully validated, immutable-by-convention catalog snapshot. */
export function buildCatalog(entries: GameDataEntries, version: number): GameDataCatalog {
  let items: readonly ItemDefinition[] = [];
  let monsters: readonly MonsterInfo[] = [];
  let dropTables: readonly DropTable[] = [];
  let shops: readonly ShopInfo[] = [];
  let npcs: readonly NpcInfo[] = [];
  let skills: readonly SkillInfo[] = [];
  let stones: readonly StoneInfo[] = [];
  let spawnGroups: readonly SpawnGroupInfo[] = [];
  let upgrades: { maxLevel: number; steps: readonly UpgradeStep[] } = {
    maxLevel: 9,
    steps: [],
  };
  let bonusPool: readonly BonusDefinition[] = [];

  wrapValidation("items", () => {
    items = buildItems({ version: 1, items: entries.items });
  });

  const itemById = indexById(items);
  const itemRefs = {
    hasItem: (id: string) => itemById.has(id),
    getItem: (id: string) => requireFrom(itemById, id, "item"),
  };
  wrapValidation("dropTables", () => {
    dropTables = buildDropTables({ version: 1, dropTables: entries.dropTables }, itemRefs);
  });
  wrapValidation("monsters", () => {
    // Built after drop tables so a typo in `dropTableId` fails the catalog
    // instead of leaving a monster that silently drops nothing.
    const dropById = indexById(dropTables);
    monsters = buildMonsters(
      { version: 1, monsters: entries.monsters },
      { hasDropTable: (id) => dropById.has(id) },
    );
  });
  wrapValidation("shops", () => {
    shops = buildShops({ version: 1, shops: entries.shops }, itemRefs);
  });

  const shopById = indexById(shops);
  const shopRefs = {
    hasShop: (id: string) => shopById.has(id),
    getShop: (id: string) => requireFrom(shopById, id, "shop"),
  };
  wrapValidation("npcs", () => {
    npcs = buildNpcs({ version: 1, npcs: entries.npcs }, shopRefs);
  });
  wrapValidation("skills", () => {
    skills = buildSkills({ version: 1, skills: entries.skills });
  });

  const monsterById = indexById(monsters);
  const dropById = indexById(dropTables);
  const monsterRefs = {
    hasMonster: (id: string) => monsterById.has(id),
    hasDropTable: (id: string) => dropById.has(id),
  };
  wrapValidation("stones", () => {
    stones = buildStones({ version: 1, stones: entries.stones }, monsterRefs);
  });
  wrapValidation("spawnGroups", () => {
    spawnGroups = buildSpawnGroups({ version: 1, groups: entries.spawnGroups }, monsterRefs);
  });
  wrapValidation("upgrades", () => {
    upgrades = buildUpgrades(
      { version: 1, maxLevel: 9, steps: entries.upgrades },
      itemRefs,
    );
  });
  wrapValidation("bonuses", () => {
    bonusPool = buildBonuses({ version: 1, bonuses: entries.bonuses });
  });

  const npcById = indexById(npcs);
  const skillById = indexById(skills);
  const stoneById = indexById(stones);
  const stoneByZone = new Map(stones.map((stone) => [stone.zoneId, stone]));
  const spawnById = indexById(spawnGroups);
  const upgradeByLevel = new Map(upgrades.steps.map((step) => [step.from, step]));
  const bonusByType = new Map(bonusPool.map((bonus) => [bonus.type, bonus]));

  return {
    version,
    items,
    monsters,
    dropTables,
    shops,
    npcs,
    skills,
    stones,
    spawnGroups,
    upgradeSteps: upgrades.steps,
    maxUpgradeLevel: upgrades.maxLevel,
    bonusPool,
    hasItem: (id) => itemById.has(id),
    getItem: (id) => requireFrom(itemById, id, "item"),
    findItem: (id) => itemById.get(id),
    hasMonster: (id) => monsterById.has(id),
    getMonster: (id) => requireFrom(monsterById, id, "monster"),
    findMonster: (id) => monsterById.get(id),
    hasDropTable: (id) => dropById.has(id),
    getDropTable: (id) => requireFrom(dropById, id, "drop table"),
    findDropTable: (id) => dropById.get(id),
    hasShop: (id) => shopById.has(id),
    getShop: (id) => requireFrom(shopById, id, "shop"),
    findShop: (id) => shopById.get(id),
    hasNpc: (id) => npcById.has(id),
    getNpc: (id) => requireFrom(npcById, id, "NPC"),
    findNpc: (id) => npcById.get(id),
    hasSkill: (id) => skillById.has(id),
    getSkill: (id) => requireFrom(skillById, id, "skill"),
    findSkill: (id) => skillById.get(id),
    hasStone: (id) => stoneById.has(id),
    getStone: (id) => requireFrom(stoneById, id, "stone"),
    findStone: (id) => stoneById.get(id),
    getStoneForZone: (zoneId) => stoneByZone.get(zoneId),
    hasSpawnGroup: (id) => spawnById.has(id),
    getSpawnGroup: (id) => requireFrom(spawnById, id, "spawn group"),
    findSpawnGroup: (id) => spawnById.get(id),
    getUpgradeStep: (level) => upgradeByLevel.get(Math.max(0, Math.floor(level))),
    getBonusDefinition: (type) => bonusByType.get(type as BonusDefinition["type"]),
    bonusesForItemType: (itemType) =>
      bonusPool.filter((bonus) => bonus.itemTypes.includes(itemType)),
    skillsForDoctrine: (classId, doctrineId) =>
      skills
        .filter((skill) => skill.classId === classId && skill.doctrineId === doctrineId)
        .sort((one, two) => one.unlockLevel - two.unlockLevel || one.id.localeCompare(two.id)),
  };
}

export const BASE_CATALOG: GameDataCatalog = buildCatalog(BASE_GAME_DATA, 1);

/** Stable identity for one dataset entry, used by override rows. */
export function entryIdOf(dataset: GameDataDataset, entry: unknown): string {
  if (typeof entry !== "object" || entry === null) {
    throw new GameDataValidationError(dataset, [
      { path: "", message: "entry must be an object" },
    ]);
  }
  const record = entry as Record<string, unknown>;
  if (dataset === "upgrades") {
    if (typeof record.from !== "number" || !Number.isInteger(record.from)) {
      throw new GameDataValidationError(dataset, [
        { path: "from", message: "upgrade entry needs an integer from" },
      ]);
    }
    return String(record.from);
  }
  if (dataset === "bonuses") {
    if (typeof record.type !== "string" || record.type === "") {
      throw new GameDataValidationError(dataset, [
        { path: "type", message: "bonus entry needs a type" },
      ]);
    }
    return record.type;
  }
  if (typeof record.id !== "string" || record.id === "") {
    throw new GameDataValidationError(dataset, [
      { path: "id", message: "entry needs an id" },
    ]);
  }
  return record.id;
}

export function mergeDataset(
  dataset: GameDataDataset,
  base: readonly unknown[],
  overrides: readonly { entryId: string; payload: unknown }[],
): readonly unknown[] {
  if (overrides.length === 0) {
    return base;
  }
  const byId = new Map<string, unknown>();
  const order: string[] = [];
  for (const entry of base) {
    const id = entryIdOf(dataset, entry);
    byId.set(id, entry);
    order.push(id);
  }
  for (const override of overrides) {
    const identity = entryIdOf(dataset, override.payload);
    if (identity !== override.entryId) {
      throw new GameDataValidationError(dataset, [
        {
          path: "id",
          message: `override identity "${identity}" does not match "${override.entryId}"`,
        },
      ]);
    }
    if (!byId.has(identity)) {
      order.push(identity);
    }
    byId.set(identity, override.payload);
  }
  const merged = order.map((id) => byId.get(id));
  if (dataset === "upgrades") {
    merged.sort(
      (one, two) =>
        Number((one as { from: number }).from) - Number((two as { from: number }).from),
    );
  } else if (dataset !== "bonuses") {
    merged.sort((one, two) =>
      entryIdOf(dataset, one).localeCompare(entryIdOf(dataset, two)),
    );
  }
  return merged;
}

export function mergeGameData(
  base: GameDataEntries,
  overrides: readonly GameDataOverrideInput[],
): GameDataEntries {
  const grouped = new Map<GameDataDataset, { entryId: string; payload: unknown }[]>();
  for (const override of overrides) {
    const list = grouped.get(override.dataset) ?? [];
    list.push({ entryId: override.entryId, payload: override.payload });
    grouped.set(override.dataset, list);
  }
  const merged = {} as Record<GameDataDataset, readonly unknown[]>;
  for (const dataset of Object.keys(base) as GameDataDataset[]) {
    merged[dataset] = mergeDataset(
      dataset,
      base[dataset],
      grouped.get(dataset) ?? [],
    );
  }
  return merged;
}

/** Rarity helper kept here so admin previews can reuse the catalog types. */
export function isKnownRarity(value: string): value is Rarity {
  return value === "common" || value === "fine" || value === "rare" || value === "legendary";
}
