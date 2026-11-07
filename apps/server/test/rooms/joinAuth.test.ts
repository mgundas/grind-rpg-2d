import { describe, expect, it, vi } from "vitest";
import { ROOM_NAME_FIELDS, ROOM_NAME_VILLAGE, type MapId } from "@jadethrone/shared";
import type { AccountAuthRecord } from "../../src/auth/accountService";
import { authenticateJoin, parseJoinOptions, type JoinAuthDeps } from "../../src/auth/joinAuth";
import { signAccessToken } from "../../src/auth/tokens";
import type { CharacterRecord } from "../../src/characters/characterMappers";
import type { WarpTokenPayload } from "../../src/rooms/warpTokens";

const SECRET = "test-access-secret-at-least-32-characters";
const ACCOUNT_ID = "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
const CHARACTER_ID = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";

function account(overrides: Partial<AccountAuthRecord> = {}): AccountAuthRecord {
  return {
    id: ACCOUNT_ID,
    email: "player@example.com",
    username: "Player",
    kingdom: "ember",
    role: "player",
    tokenVersion: 2,
    bannedUntil: null,
    banReason: null,
    ...overrides,
  };
}

function character(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: CHARACTER_ID,
    accountId: ACCOUNT_ID,
    name: "Grinder",
    classId: "warrior",
    doctrine: null,
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
    level: 1,
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
    skills: {},
    map: ROOM_NAME_VILLAGE,
    x: 100,
    y: 200,
    channel: 1,
    pvpMode: "peaceful",
    ...overrides,
  };
}

function deps(overrides: Partial<JoinAuthDeps> = {}): JoinAuthDeps {
  return {
    accessSecret: SECRET,
    getAccountById: vi.fn(async () => account()),
    getCharacterForAccount: vi.fn(async () => character()),
    consumeWarpToken: vi.fn(() => null),
    ...overrides,
  };
}

function token(tokenVersion = 2): string {
  return signAccessToken({ accountId: ACCOUNT_ID, tokenVersion, secret: SECRET, ttlSeconds: 3600 });
}

const VALID_OPTIONS = { characterId: CHARACTER_ID, map: ROOM_NAME_VILLAGE };

describe("parseJoinOptions", () => {
  it("requires a uuid character and a known map", () => {
    expect(parseJoinOptions(VALID_OPTIONS)).not.toBeNull();
    expect(parseJoinOptions({ ...VALID_OPTIONS, characterId: "nope" })).toBeNull();
    expect(parseJoinOptions({ ...VALID_OPTIONS, map: "map_nowhere" })).toBeNull();
    expect(parseJoinOptions({ map: ROOM_NAME_VILLAGE })).toBeNull();
  });
});

describe("authenticateJoin (JWT)", () => {
  it("accepts a valid token, matching character and map", async () => {
    const identity = await authenticateJoin(deps(), token(), VALID_OPTIONS);
    expect(identity?.account.id).toBe(ACCOUNT_ID);
    expect(identity?.character.id).toBe(CHARACTER_ID);
    expect(identity?.warpSpawn).toBeNull();
  });

  it("rejects missing, invalid and stale tokens", async () => {
    expect(await authenticateJoin(deps(), undefined, VALID_OPTIONS)).toBeNull();
    expect(await authenticateJoin(deps(), "garbage", VALID_OPTIONS)).toBeNull();
    expect(await authenticateJoin(deps(), token(1), VALID_OPTIONS)).toBeNull();
  });

  it("rejects a banned account", async () => {
    const banned = account({ bannedUntil: new Date(Date.now() + 60_000) });
    expect(
      await authenticateJoin(
        deps({ getAccountById: vi.fn(async () => banned) }),
        token(),
        VALID_OPTIONS,
      ),
    ).toBeNull();
  });

  it("rejects a character on another map", async () => {
    const elsewhere = character({ map: ROOM_NAME_FIELDS });
    expect(
      await authenticateJoin(
        deps({ getCharacterForAccount: vi.fn(async () => elsewhere) }),
        token(),
        VALID_OPTIONS,
      ),
    ).toBeNull();
  });

  it("rejects a character that does not belong to the account", async () => {
    expect(
      await authenticateJoin(
        deps({ getCharacterForAccount: vi.fn(async () => null) }),
        token(),
        VALID_OPTIONS,
      ),
    ).toBeNull();
  });

  it("rejects invalid join options", async () => {
    expect(await authenticateJoin(deps(), token(), { characterId: "x" })).toBeNull();
  });
});

describe("authenticateJoin (warp token)", () => {
  const warp: WarpTokenPayload = {
    map: ROOM_NAME_FIELDS,
    x: 300,
    y: 400,
    accountId: ACCOUNT_ID,
    characterId: CHARACTER_ID,
    tokenVersion: 2,
  };

  it("accepts a bound warp token without a JWT and exposes the spawn", async () => {
    const identity = await authenticateJoin(
      deps({
        consumeWarpToken: vi.fn(() => warp),
        getCharacterForAccount: vi.fn(async () => character({ map: ROOM_NAME_FIELDS })),
      }),
      undefined,
      { characterId: CHARACTER_ID, map: ROOM_NAME_FIELDS, warpToken: "warp-token" },
    );
    expect(identity?.warpSpawn).toEqual({ mapId: ROOM_NAME_FIELDS, x: 300, y: 400 });
  });

  it("rejects a warp token bound to another character", async () => {
    const identity = await authenticateJoin(
      deps({ consumeWarpToken: vi.fn(() => warp) }),
      undefined,
      {
        characterId: "11111111-1111-4111-8111-111111111111",
        map: ROOM_NAME_FIELDS,
        warpToken: "warp-token",
      },
    );
    expect(identity).toBeNull();
  });

  it("rejects an invalid or wrong-map warp token", async () => {
    const map: MapId = ROOM_NAME_FIELDS;
    expect(
      await authenticateJoin(deps({ consumeWarpToken: vi.fn(() => null) }), undefined, {
        characterId: CHARACTER_ID,
        map,
        warpToken: "nope",
      }),
    ).toBeNull();
  });

  it("rejects a warp token minted before a login/logout bump", async () => {
    const identity = await authenticateJoin(
      deps({ consumeWarpToken: vi.fn(() => ({ ...warp, tokenVersion: 1 })) }),
      undefined,
      { characterId: CHARACTER_ID, map: ROOM_NAME_FIELDS, warpToken: "warp-token" },
    );
    expect(identity).toBeNull();
  });

  it("rejects a banned account even with a valid warp token", async () => {
    const banned = account({ bannedUntil: new Date(Date.now() + 60_000) });
    expect(
      await authenticateJoin(
        deps({
          consumeWarpToken: vi.fn(() => warp),
          getAccountById: vi.fn(async () => banned),
          getCharacterForAccount: vi.fn(async () => character({ map: ROOM_NAME_FIELDS })),
        }),
        undefined,
        { characterId: CHARACTER_ID, map: ROOM_NAME_FIELDS, warpToken: "warp-token" },
      ),
    ).toBeNull();
  });
});
