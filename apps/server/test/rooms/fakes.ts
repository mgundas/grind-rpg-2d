import { randomUUID } from "node:crypto";
import { vi, type Mock } from "vitest";
import {
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  type ClassId,
  type Gender,
  type KingdomId,
  type MapId,
} from "@jadethrone/shared";
import { FIELDS_SPAWN, VILLAGE_SPAWN } from "@jadethrone/data";
import type { AccountAuthRecord } from "../../src/auth/accountService";
import type { JoinAuthenticator, JoinIdentity } from "../../src/auth/joinAuth";
import type { BulkPositionSave, PositionSave } from "../../src/characters/characterService";
import type { CharacterRecord } from "../../src/characters/characterMappers";
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
  x?: number;
  y?: number;
  spawnX?: number;
  spawnY?: number;
  warpToken?: string;
}

export interface FakeServices {
  joinAuthenticator: JoinAuthenticator;
  savePosition: Mock<(characterId: string, save: PositionSave) => Promise<boolean>>;
  savePositions: Mock<(saves: ReadonlyArray<BulkPositionSave>) => Promise<void>>;
  identities: Map<string, JoinIdentity>;
  saved: BulkPositionSave[];
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
    role: "player",
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
    doctrine: null,
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
    skillPoints: 0,
    map,
    x,
    y,
    channel: 1,
    pvpMode: "peaceful",
  };
}

export function createFakeServices(): FakeServices {
  const identities = new Map<string, JoinIdentity>();
  const saved: BulkPositionSave[] = [];

  function applySaved(save: BulkPositionSave): void {
    saved.push(save);
    const identity = identities.get(save.characterId);
    if (identity) {
      identities.set(save.characterId, {
        ...identity,
        character: { ...identity.character, map: save.mapId, x: save.x, y: save.y },
      });
    }
  }

  const savePosition = vi.fn(async (characterId: string, save: PositionSave) => {
    applySaved({ characterId, ...save });
    return true;
  });
  const savePositions = vi.fn(async (saves: ReadonlyArray<BulkPositionSave>) => {
    for (const save of saves) {
      applySaved(save);
    }
  });

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

  return {
    joinAuthenticator,
    savePosition,
    savePositions,
    identities,
    saved,
    prepare,
    reset() {
      identities.clear();
      saved.length = 0;
      vi.clearAllMocks();
    },
  };
}
