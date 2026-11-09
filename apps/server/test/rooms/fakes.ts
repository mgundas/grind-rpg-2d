import { randomUUID } from "node:crypto";
import { vi, type Mock } from "vitest";
import {
  EQUIP_SLOTS,
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  emptyInventory,
  type ClassId,
  type Gender,
  type InventoryState,
  type ItemBonus,
  type ItemStack,
  type KingdomId,
  type MapId,
  type WarehouseState,
} from "@jadethrone/shared";
import { FIELDS_SPAWN, VILLAGE_SPAWN } from "@jadethrone/data";
import { createAdminBus, type AdminBus } from "../../src/admin/liveBus";
import type { AccountAuthRecord } from "../../src/auth/accountService";
import type { JoinAuthenticator, JoinIdentity } from "../../src/auth/joinAuth";
import type { BulkCharacterSave, CharacterSave } from "../../src/characters/characterService";
import type { CharacterRecord } from "../../src/characters/characterMappers";
import type { SkillStateChange } from "../../src/characters/characterSkills";
import type { ItemPlan } from "../../src/items/itemChanges";
import { ItemError } from "../../src/items/errors";
import type { ItemService } from "../../src/items/service";
import { planSkillBookRead } from "../../src/items/skillBook";
import { BASE_CATALOG } from "@jadethrone/data/catalog";
import {
  assignReceivedSlots,
  TradeExecutionError,
} from "../../src/items/tradeTransaction";
import { consumeWarpTokenPayload, type WarpTokenPayload } from "../../src/rooms/warpTokens";

/**
 * Room-test fake services. The real auth is covered by `joinAuth.test.ts` and
 * the REST tests; these rooms only need an identity + a place to record saves.
 *
 * Test-only options: `characterId` reuses an identity (duplicate-join tests),
 * `spawnX`/`spawnY` simulate a saved position, and `x`/`y` are deliberately
 * ignored to prove onJoin never trusts client-supplied positions.
 */
export interface FakeJoinOptions {
  characterId?: string;
  name?: string;
  kingdom?: string;
  map?: MapId;
  classId?: ClassId;
  gender?: Gender;
  hairStyle?: number;
  hairColor?: number;
  level?: number;
  role?: "player" | "gm" | "admin";
  doctrine?: string | null;
  skillPoints?: number;
  skills?: Record<string, number>;
  x?: number;
  y?: number;
  spawnX?: number;
  spawnY?: number;
  warpToken?: string;
}

export interface FakeServices {
  joinAuthenticator: JoinAuthenticator;
  saveCharacter: Mock<(characterId: string, save: CharacterSave) => Promise<boolean>>;
  saveCharacters: Mock<(saves: ReadonlyArray<BulkCharacterSave>) => Promise<void>>;
  loadCharacter: (accountId: string, characterId: string) => Promise<CharacterRecord | null>;
  saveSkillState: Mock<(characterId: string, change: SkillStateChange) => Promise<boolean>>;
  items: ItemService;
  adminBus: AdminBus;
  logChat: () => Promise<void>;
  logAdminAction: () => Promise<void>;
  /** Seed an item row directly (room tests start with a clean inventory). */
  giveItem: (row: {
    id: string;
    itemId: string;
    location: "inventory" | "equipment" | "ground" | "warehouse";
    slot: number | null;
    quantity?: number;
    ownerCharacterId?: string;
    ownerAccountId?: string;
    mapId?: string;
    upgradeLevel?: number;
    bonuses?: ItemBonus[];
  }) => void;
  setGold: (characterId: string, gold: number) => void;
  goldOf: (characterId: string) => number;
  identities: Map<string, JoinIdentity>;
  saved: BulkCharacterSave[];
  prepare: (options?: FakeJoinOptions) => JoinIdentity;
  reset: () => void;
}

function spawnFor(map: MapId): { x: number; y: number } {
  return map === ROOM_NAME_FIELDS ? FIELDS_SPAWN : VILLAGE_SPAWN;
}

function makeAccount(options: FakeJoinOptions): AccountAuthRecord {
  return {
    id: randomUUID(),
    email: `room${Math.random().toString(36).slice(2, 8)}@example.com`,
    username: `Room${Math.random().toString(36).slice(2, 8)}`,
    kingdom: (options.kingdom as KingdomId | undefined) ?? "ember",
    role: options.role ?? "player",
    tokenVersion: 0,
    bannedUntil: null,
    banReason: null,
  };
}

function makeCharacter(
  accountId: string,
  map: MapId,
  x: number,
  y: number,
  options: FakeJoinOptions,
): CharacterRecord {
  return {
    id: options.characterId ?? randomUUID(),
    accountId,
    name: options.name ?? "Player",
    classId: options.classId ?? "warrior",
    doctrine: options.doctrine ?? null,
    gender: options.gender ?? "male",
    hairStyle: options.hairStyle ?? 0,
    hairColor: options.hairColor ?? 0,
    level: options.level ?? 1,
    xp: 0,
    gold: 0,
    hp: 316,
    mp: 92,
    statVit: 4,
    statInt: 3,
    statStr: 6,
    statDex: 3,
    statPoints: 0,
    skillPoints: options.skillPoints ?? 0,
    skills: { ...(options.skills ?? {}) },
    map,
    x,
    y,
    channel: 1,
    pvpMode: "peaceful",
  };
}

export function createFakeServices(): FakeServices {
  const identities = new Map<string, JoinIdentity>();
  const saved: BulkCharacterSave[] = [];

  function applySaved(save: BulkCharacterSave): void {
    saved.push(save);
    const identity = identities.get(save.characterId);
    if (identity) {
      identities.set(save.characterId, {
        ...identity,
        character: {
          ...identity.character,
          map: save.mapId,
          x: save.x,
          y: save.y,
          hp: save.hp,
          mp: save.mp,
          xp: save.xp,
          level: save.level,
          statVit: save.statVit,
          statInt: save.statInt,
          statStr: save.statStr,
          statDex: save.statDex,
          statPoints: save.statPoints,
        },
      });
    }
  }

  const saveCharacter = vi.fn(async (characterId: string, save: CharacterSave) => {
    applySaved({ characterId, ...save });
    return true;
  });
  const saveCharacters = vi.fn(async (saves: ReadonlyArray<BulkCharacterSave>) => {
    for (const save of saves) {
      applySaved(save);
    }
  });

  async function loadCharacter(
    accountId: string,
    characterId: string,
  ): Promise<CharacterRecord | null> {
    for (const identity of identities.values()) {
      if (identity.account.id === accountId && identity.character.id === characterId) {
        return identity.character;
      }
    }
    return null;
  }

  const saveSkillState = vi.fn(
    async (characterId: string, change: SkillStateChange): Promise<boolean> => {
      const identity = identities.get(characterId);
      if (!identity) {
        return false;
      }
      const character = identity.character;
      if (change.doctrine !== undefined) {
        character.doctrine = change.doctrine;
      }
      if (change.skillPoints !== undefined) {
        character.skillPoints = change.skillPoints;
      }
      if (change.ranks) {
        for (const [skillId, rank] of Object.entries(change.ranks)) {
          if (rank <= 0) {
            delete character.skills[skillId];
          } else {
            character.skills[skillId] = rank;
          }
        }
      }
      return true;
    },
  );

  function prepare(options: FakeJoinOptions = {}): JoinIdentity {
    const account = makeAccount(options);
    const map = options.map ?? ROOM_NAME_VILLAGE;
    const spawn = spawnFor(map);
    const x = options.spawnX ?? spawn.x;
    const y = options.spawnY ?? spawn.y;
    const identity: JoinIdentity = {
      account,
      character: makeCharacter(account.id, map, x, y, options),
      warpSpawn: null,
    };
    identities.set(identity.character.id, identity);
    return identity;
  }

  const joinAuthenticator: JoinAuthenticator = async (_token, rawOptions) => {
    const options = (rawOptions ?? {}) as FakeJoinOptions;
    if (options.name === "__reject__") {
      return null;
    }

    let warp: WarpTokenPayload | null = null;
    if (options.warpToken) {
      warp =
        consumeWarpTokenPayload(options.warpToken, ROOM_NAME_VILLAGE) ??
        consumeWarpTokenPayload(options.warpToken, ROOM_NAME_FIELDS);
      if (!warp) {
        return null;
      }
    }

    const existing = options.characterId ? identities.get(options.characterId) : undefined;
    const characterId = options.characterId ?? randomUUID();
    const map = warp?.map ?? options.map ?? existing?.character.map ?? ROOM_NAME_VILLAGE;
    const spawn = spawnFor(map);
    const x = warp?.x ?? options.spawnX ?? existing?.character.x ?? spawn.x;
    const y = warp?.y ?? options.spawnY ?? existing?.character.y ?? spawn.y;

    const identity: JoinIdentity = existing
      ? {
          ...existing,
          character: { ...existing.character, map, x, y },
          warpSpawn: warp ? { mapId: warp.map, x, y } : null,
        }
      : {
          account: makeAccount(options),
          character: makeCharacter(characterId, map, x, y, { ...options, characterId }),
          warpSpawn: warp ? { mapId: warp.map, x, y } : null,
        };

    identities.set(identity.character.id, identity);
    return identity;
  };

  // In-memory item store. It applies the same ItemChange[] as the DB executor;
  // the game rules remain in the planners, so this fake has no policy.
  interface FakeItemRow {
    stack: ItemStack;
    location: "inventory" | "equipment" | "warehouse" | "ground";
    ownerCharacterId: string | null;
    ownerAccountId: string | null;
    mapId: string | null;
  }
  const itemRows = new Map<string, FakeItemRow>();
  const goldByCharacter = new Map<string, number>();
  const adminBus = createAdminBus();

  function inventoryFromRows(characterId: string): InventoryState {
    const state = emptyInventory();
    for (const row of itemRows.values()) {
      if (row.ownerCharacterId !== characterId) {
        continue;
      }
      if (row.location === "inventory") {
        state.items.push({ ...row.stack, bonuses: [...row.stack.bonuses] });
      } else if (row.location === "equipment") {
        const index = row.stack.slot;
        if (index >= 0 && index < EQUIP_SLOTS.length) {
          state.equipment[index] = { ...row.stack, bonuses: [...row.stack.bonuses] };
        }
      }
    }
    state.items.sort((a, b) => a.slot - b.slot);
    return state;
  }

  function warehouseFromRows(accountId: string): WarehouseState {
    return {
      items: [...itemRows.values()]
        .filter(
          (row) => row.ownerAccountId === accountId && row.location === "warehouse",
        )
        .map((row) => ({ ...row.stack, bonuses: [...row.stack.bonuses] }))
        .sort((a, b) => a.slot - b.slot),
    };
  }

  const itemsService: ItemService = {
    async loadInventory(accountId, characterId) {
      const identity = identities.get(characterId);
      if (!identity || identity.account.id !== accountId) {
        throw new ItemError("stale", "Character no longer exists.");
      }
      return {
        inventory: inventoryFromRows(characterId),
        gold: goldByCharacter.get(characterId) ?? 0,
        repairs: [],
      };
    },
    async loadWarehouse(accountId) {
      return warehouseFromRows(accountId);
    },
    async apply(accountId, characterId, plan: ItemPlan) {
      for (const change of plan.changes) {
        if (change.kind === "insert") {
          itemRows.set(change.id, {
            stack: {
              id: change.id,
              itemId: change.itemId,
              slot: change.slot,
              quantity: change.quantity,
              upgradeLevel: change.upgradeLevel,
              bonuses: [...change.bonuses],
            },
            location: change.location,
            ownerCharacterId: change.ownerCharacterId,
            ownerAccountId: change.ownerAccountId,
            mapId: null,
          });
        } else if (change.kind === "update") {
          const row = itemRows.get(change.id);
          if (!row) {
            throw new ItemError("stale", "Item no longer exists.");
          }
          row.stack = {
            ...row.stack,
            slot: change.to.slot ?? row.stack.slot,
            quantity: change.to.quantity,
            upgradeLevel: change.to.upgradeLevel,
            bonuses: [...change.to.bonuses],
          };
          row.location = change.to.location;
          row.ownerCharacterId = change.to.ownerCharacterId;
          row.ownerAccountId = change.to.ownerAccountId;
          row.mapId = change.to.mapId;
        } else {
          itemRows.delete(change.id);
        }
      }
      let gold = goldByCharacter.get(characterId) ?? 0;
      if (plan.gold) {
        gold = Math.max(0, gold + plan.gold.delta);
        goldByCharacter.set(characterId, gold);
      }
      void accountId;
      return { gold };
    },
    async readSkillBook(input) {
      const identity = identities.get(input.characterId);
      if (!identity || identity.account.id !== input.accountId) {
        throw new ItemError("stale", "Character no longer exists.");
      }
      const character = identity.character;
      const read = planSkillBookRead(
        inventoryFromRows(input.characterId),
        input.characterId,
        input.bookInstanceId,
        {
          skillId: input.skillId,
          rank: character.skills[input.skillId] ?? 0,
          classId: character.classId,
          doctrine: character.doctrine,
          mastery: character.skillMastery?.[input.skillId] ?? {
            level: 0,
            lastReadAtMs: 0,
          },
          now: input.now,
          rng: input.rng,
        },
        input.catalog ?? BASE_CATALOG,
      );
      const { gold } = await itemsService.apply(
        input.accountId,
        input.characterId,
        read.plan,
      );
      character.skillMastery = {
        ...(character.skillMastery ?? {}),
        [input.skillId]: { level: read.level, lastReadAtMs: input.now },
      };
      return {
        inventory: read.state,
        gold,
        skillId: input.skillId,
        bookDefinitionId: read.bookItemId,
        success: read.success,
        previousLevel: read.previousLevel,
        masterLevel: read.level,
        readAtMs: read.readAtMs,
        nextReadAtMs: read.nextReadAtMs,
        chance: read.chance,
      };
    },
    async trade(input) {
      const [first, second] = input.participants;
      if (
        first.characterId === second.characterId ||
        first.accountId === second.accountId
      ) {
        throw new TradeExecutionError("invalid_offer", "Invalid trade participants.");
      }
      const [a, b] =
        first.characterId < second.characterId ? [first, second] : [second, first];
      const offeredIds = new Set([...a.items, ...b.items].map((item) => item.id));
      if (offeredIds.size !== a.items.length + b.items.length) {
        throw new TradeExecutionError("invalid_offer", "Duplicate offered item.");
      }
      for (const side of [a, b]) {
        if (side.gold < 0 || !Number.isInteger(side.gold)) {
          throw new TradeExecutionError("invalid_offer", "Invalid gold offer.");
        }
        for (const stack of side.items) {
          const row = itemRows.get(stack.id);
          if (!row) {
            throw new TradeExecutionError("stale", "Offered item no longer exists.");
          }
          if (row.ownerCharacterId !== side.characterId) {
            throw new TradeExecutionError("not_owner", "Offered item is not yours.");
          }
          if (
            row.location !== "inventory" ||
            row.stack.slot !== stack.slot ||
            row.stack.quantity !== stack.quantity ||
            row.stack.upgradeLevel !== stack.upgradeLevel ||
            JSON.stringify(row.stack.bonuses) !== JSON.stringify(stack.bonuses)
          ) {
            throw new TradeExecutionError("stale", "Offered item changed.");
          }
        }
        if ((goldByCharacter.get(side.characterId) ?? 0) < side.gold) {
          throw new TradeExecutionError("no_gold", "Not enough gold.");
        }
      }

      const aBalance = goldByCharacter.get(a.characterId) ?? 0;
      const bBalance = goldByCharacter.get(b.characterId) ?? 0;
      const aOutgoing = new Set(a.items.map((item) => item.id));
      const bOutgoing = new Set(b.items.map((item) => item.id));
      const inventoryFor = (characterId: string, outgoing: Set<string>) =>
        [...itemRows.values()]
          .filter(
            (row) =>
              row.ownerCharacterId === characterId &&
              row.location === "inventory" &&
              !outgoing.has(row.stack.id),
          )
          .map((row) => ({ ...row.stack, bonuses: [...row.stack.bonuses] }));

      const aReceives = assignReceivedSlots(inventoryFor(a.characterId, aOutgoing), b.items);
      const bReceives = assignReceivedSlots(inventoryFor(b.characterId, bOutgoing), a.items);
      if (aReceives === null || bReceives === null) {
        throw new TradeExecutionError("inventory_full", "The receiver has no room.");
      }
      const assigned = new Map<string, number>();
      for (const stack of [...aReceives, ...bReceives]) {
        assigned.set(stack.id, stack.slot);
      }
      for (const giving of [
        { giver: a, receiver: b },
        { giver: b, receiver: a },
      ]) {
        for (const stack of giving.giver.items) {
          const row = itemRows.get(stack.id)!;
          row.ownerCharacterId = giving.receiver.characterId;
          row.stack.slot = assigned.get(stack.id)!;
        }
      }
      const newA = aBalance - a.gold + b.gold;
      const newB = bBalance - b.gold + a.gold;
      goldByCharacter.set(a.characterId, newA);
      goldByCharacter.set(b.characterId, newB);
      return {
        tradeId: input.tradeId,
        goldByCharacter: { [a.characterId]: newA, [b.characterId]: newB },
        receivedByCharacter: { [a.characterId]: aReceives, [b.characterId]: bReceives },
      };
    },
    async insertGroundItem(row) {
      itemRows.set(row.id, {
        stack: {
          id: row.id,
          itemId: row.definitionId,
          slot: row.slot ?? 0,
          quantity: row.quantity ?? 1,
          upgradeLevel: row.upgradeLevel ?? 0,
          bonuses: row.bonuses ?? [],
        },
        location: "ground",
        ownerCharacterId: row.ownerCharacterId ?? null,
        ownerAccountId: row.ownerAccountId ?? null,
        mapId: row.mapId ?? null,
      });
      return true;
    },
    async deleteGroundItem(id) {
      const row = itemRows.get(id);
      if (!row || row.location !== "ground") {
        return false;
      }
      itemRows.delete(id);
      return true;
    },
    async deleteExpiredGroundItems(mapId) {
      let deleted = 0;
      for (const [id, row] of itemRows) {
        if (row.location === "ground" && row.mapId === mapId) {
          itemRows.delete(id);
          deleted++;
        }
      }
      return deleted;
    },
  };

  function giveItem(row: {
    id: string;
    itemId: string;
    location: "inventory" | "equipment" | "ground" | "warehouse";
    slot: number | null;
    quantity?: number;
    ownerCharacterId?: string;
    ownerAccountId?: string;
    mapId?: string;
    upgradeLevel?: number;
    bonuses?: ItemBonus[];
  }): void {
    itemRows.set(row.id, {
      stack: {
        id: row.id,
        itemId: row.itemId,
        slot: row.slot ?? 0,
        quantity: row.quantity ?? 1,
        upgradeLevel: row.upgradeLevel ?? 0,
        bonuses: row.bonuses ?? [],
      },
      location: row.location,
      ownerCharacterId: row.ownerCharacterId ?? null,
      ownerAccountId: row.ownerAccountId ?? null,
      mapId: row.mapId ?? null,
    });
  }

  return {
    joinAuthenticator,
    saveCharacter,
    saveCharacters,
    loadCharacter,
    saveSkillState,
    items: itemsService,
    adminBus,
    logChat: async () => undefined,
    logAdminAction: async () => undefined,
    giveItem,
    setGold(characterId, gold) {
      goldByCharacter.set(characterId, gold);
    },
    goldOf(characterId) {
      return goldByCharacter.get(characterId) ?? 0;
    },
    identities,
    saved,
    prepare,
    reset() {
      identities.clear();
      itemRows.clear();
      goldByCharacter.clear();
      adminBus.clear();
      saved.length = 0;
      vi.clearAllMocks();
    },
  };
}
