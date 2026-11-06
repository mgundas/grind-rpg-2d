import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VILLAGE_SPAWN } from "@jadethrone/data";
import type { CreateCharacterRequest } from "@jadethrone/shared";
import {
  getAccountById,
  isBanned,
  loginAccount,
  logoutAccount,
  refreshSession,
  registerAccount,
  type AuthDeps,
} from "../../src/auth/accountService";
import { verifyAccessToken, hashToken } from "../../src/auth/tokens";
import {
  createCharacter,
  deleteCharacter,
  getCharacterForAccount,
  listCharacters,
  saveCharacterPosition,
  saveCharacterPositions,
} from "../../src/characters/characterService";
import type { Db } from "../../src/db/client";
import { accounts, characters, sessions } from "../../src/db/schema";
import { ServiceError } from "../../src/errors";
import { createTestDb, hasTestDatabase, type TestDb } from "./testDb";

const ACCESS_SECRET = "test-access-secret-at-least-32-characters";
const REFRESH_SECRET = "test-refresh-secret-at-least-32-characters";

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function deps(db: Db): AuthDeps {
  return {
    db,
    accessSecret: ACCESS_SECRET,
    refreshSecret: REFRESH_SECRET,
    accessTtlSeconds: 3600,
    refreshTtlSeconds: 3600,
  };
}

function credentials() {
  return {
    email: `user${suffix()}@example.com`,
    username: `User${suffix()}`,
    password: "correct-horse-battery",
    kingdom: "ember" as const,
  };
}

function characterInput(overrides: Partial<CreateCharacterRequest> = {}): CreateCharacterRequest {
  return {
    name: `Hero${suffix()}`,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
    ...overrides,
  };
}

async function register(db: Db) {
  const creds = credentials();
  const result = await registerAccount(deps(db), creds);
  return { creds, result };
}

async function liveSessions(db: Db, accountId: string) {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.accountId, accountId), isNull(sessions.revokedAt)));
}

describe("database unavailable", () => {
  it("maps a refused connection to database_unavailable (503)", async () => {
    const pool = new Pool({
      connectionString: "postgres://nobody@127.0.0.1:1/jade_throne",
      connectionTimeoutMillis: 250,
      max: 1,
    });
    const unreachable = drizzle(pool);
    try {
      await expect(
        loginAccount(
          {
            db: unreachable as unknown as Db,
            accessSecret: ACCESS_SECRET,
            refreshSecret: REFRESH_SECRET,
            accessTtlSeconds: 3600,
            refreshTtlSeconds: 3600,
          },
          { login: "someone", password: "whatever" },
        ),
      ).rejects.toMatchObject({ code: "database_unavailable", status: 503 });
    } finally {
      await pool.end();
    }
  });
});

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("persistence services (real Postgres)", () => {
  let testDb: TestDb;
  let db: Db;

  beforeAll(async () => {
    testDb = await createTestDb();
    db = testDb.db;
  }, 30_000);

  afterAll(async () => {
    await testDb?.close();
  });

  describe("accounts and sessions", () => {
    it("registers an account, a live session and no characters", async () => {
      const { creds, result } = await register(db);
      expect(result.characters).toEqual([]);
      expect(result.account.email).toBe(creds.email);
      expect(result.account.kingdom).toBe("ember");
      expect(result.account.role).toBe("player");

      const [row] = await db.select().from(accounts).where(eq(accounts.email, creds.email));
      expect(row).toBeDefined();
      expect(row!.passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(row!.tokenVersion).toBe(0);
      expect(row!.lastLogin).not.toBeNull();

      const live = await liveSessions(db, row!.id);
      expect(live).toHaveLength(1);
      expect(live[0]!.tokenHash).toBe(hashToken(result.tokens.refreshToken));

      const claims = verifyAccessToken(result.tokens.accessToken, ACCESS_SECRET);
      expect(claims.ok).toBe(true);
      if (claims.ok) expect(claims.claims.tv).toBe(0);
    });

    it("rejects duplicate email and username case-insensitively", async () => {
      const { creds } = await register(db);
      await expect(
        registerAccount(deps(db), { ...creds, email: creds.email.toUpperCase() }),
      ).rejects.toMatchObject({ code: "email_taken" });
      await expect(
        registerAccount(deps(db), {
          ...creds,
          email: `other${suffix()}@example.com`,
          username: creds.username.toUpperCase(),
        }),
      ).rejects.toMatchObject({ code: "username_taken" });
    });

    it("logs in by email or username, case-insensitively", async () => {
      const { creds } = await register(db);
      const byEmail = await loginAccount(deps(db), {
        login: creds.email.toUpperCase(),
        password: creds.password,
      });
      expect(byEmail.account.id).toBeTruthy();
      const byUsername = await loginAccount(deps(db), {
        login: creds.username.toUpperCase(),
        password: creds.password,
      });
      expect(byUsername.account.id).toBe(byEmail.account.id);
    });

    it("returns the same error for an unknown user and a wrong password", async () => {
      const { creds } = await register(db);
      const unknown = await loginAccount(deps(db), {
        login: `nobody${suffix()}@example.com`,
        password: "wrong-password",
      }).catch((error: unknown) => error);
      const wrong = await loginAccount(deps(db), {
        login: creds.email,
        password: "wrong-password",
      }).catch((error: unknown) => error);
      expect(unknown).toBeInstanceOf(ServiceError);
      expect(wrong).toBeInstanceOf(ServiceError);
      expect((unknown as ServiceError).code).toBe("invalid_credentials");
      expect((wrong as ServiceError).code).toBe("invalid_credentials");
      expect((unknown as ServiceError).message).toBe((wrong as ServiceError).message);
    });

    it("bumps the token version and leaves exactly one live session per login", async () => {
      const { creds, result } = await register(db);
      const accountId = result.account.id;

      const second = await loginAccount(deps(db), {
        login: creds.email,
        password: creds.password,
      });
      const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
      expect(row!.tokenVersion).toBe(1);
      const live = await liveSessions(db, accountId);
      expect(live).toHaveLength(1);

      const stale = verifyAccessToken(result.tokens.accessToken, ACCESS_SECRET);
      expect(stale.ok).toBe(true);
      if (stale.ok) expect(stale.claims.tv).not.toBe(row!.tokenVersion);

      const fresh = verifyAccessToken(second.tokens.accessToken, ACCESS_SECRET);
      expect(fresh.ok).toBe(true);
      if (fresh.ok) expect(fresh.claims.tv).toBe(row!.tokenVersion);
    });

    it("serialises parallel logins into one live session without deadlock", async () => {
      const { creds, result } = await register(db);
      const accountId = result.account.id;

      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          loginAccount(deps(db), { login: creds.email, password: creds.password }),
        ),
      );
      expect(attempts).toHaveLength(8);

      const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
      expect(row!.tokenVersion).toBe(8);
      expect(await liveSessions(db, accountId)).toHaveLength(1);
    });

    it("rejects banned accounts without writing a session", async () => {
      const { creds, result } = await register(db);
      const accountId = result.account.id;
      const bannedUntil = new Date(Date.now() + 60_000);
      await db
        .update(accounts)
        .set({ bannedUntil, banReason: "test ban" })
        .where(eq(accounts.id, accountId));

      await expect(
        loginAccount(deps(db), { login: creds.email, password: creds.password }),
      ).rejects.toMatchObject({ code: "account_banned" });

      const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
      expect(row!.tokenVersion).toBe(0);
      expect(await liveSessions(db, accountId)).toHaveLength(1); // the registration session
      expect(isBanned(row!.bannedUntil)).toBe(true);

      const past = new Date(Date.now() - 1000);
      expect(isBanned(past)).toBe(false);
      const account = await getAccountById(db, accountId);
      expect(account?.tokenVersion).toBe(0);
    });

    it("rotates refresh tokens and rejects replay without nuking the live session", async () => {
      const { result } = await register(db);
      const accountId = result.account.id;
      const rotated = await refreshSession(deps(db), result.tokens.refreshToken);
      expect(rotated.tokens.refreshToken).not.toBe(result.tokens.refreshToken);

      const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
      expect(row!.tokenVersion).toBe(0);
      expect(await liveSessions(db, accountId)).toHaveLength(1);

      await expect(refreshSession(deps(db), result.tokens.refreshToken)).rejects.toMatchObject({
        code: "unauthorized",
      });
      expect(await liveSessions(db, accountId)).toHaveLength(1);
    });

    it("lets only one of two concurrent refreshes rotate", async () => {
      const { result } = await register(db);
      const settled = await Promise.allSettled([
        refreshSession(deps(db), result.tokens.refreshToken),
        refreshSession(deps(db), result.tokens.refreshToken),
      ]);
      const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
      const rejected = settled.filter((entry) => entry.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "unauthorized",
      });
      expect(await liveSessions(db, result.account.id)).toHaveLength(1);
    });

    it("rejects refresh tokens with an unknown session id or the wrong token type", async () => {
      const { result } = await register(db);
      await expect(refreshSession(deps(db), result.tokens.accessToken)).rejects.toMatchObject({
        code: "unauthorized",
      });
      await expect(refreshSession(deps(db), "garbage")).rejects.toMatchObject({
        code: "unauthorized",
      });
    });

    it("revokes on logout, bumps once and is idempotent", async () => {
      const { result } = await register(db);
      const accountId = result.account.id;
      await expect(logoutAccount(deps(db), result.tokens.refreshToken)).resolves.toEqual({
        accountId,
        tokenVersion: 1,
      });

      const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId));
      expect(row!.tokenVersion).toBe(1);
      expect(await liveSessions(db, accountId)).toHaveLength(0);

      await expect(logoutAccount(deps(db), result.tokens.refreshToken)).resolves.toBeNull();
      const [again] = await db.select().from(accounts).where(eq(accounts.id, accountId));
      expect(again!.tokenVersion).toBe(1);

      await expect(refreshSession(deps(db), result.tokens.refreshToken)).rejects.toMatchObject({
        code: "unauthorized",
      });
    });
  });

  describe("characters", () => {
    it("creates a persisted level-1 warrior at the village spawn", async () => {
      const { result } = await register(db);
      const name = `Warrior${suffix()}`;
      const input = characterInput({ name, classId: "warrior" });
      const summary = await createCharacter(db, result.account.id, input);
      expect(summary).toMatchObject({
        name,
        classId: "warrior",
        level: 1,
        map: "map_ember_village",
        gender: "male",
        hairStyle: 0,
        hairColor: 0,
      });
      expect(summary.x).toBeCloseTo(VILLAGE_SPAWN.x, 2);
      expect(summary.y).toBeCloseTo(VILLAGE_SPAWN.y, 2);

      const [row] = await db.select().from(characters).where(eq(characters.id, summary.id));
      expect(row!.hp).toBe(316);
      expect(row!.mp).toBe(92);
      expect(row!.statVit).toBe(4);
      expect(row!.statStr).toBe(6);
      expect(row!.doctrine).toBeNull();
      expect(row!.channel).toBe(1);
      expect(row!.pvpMode).toBe("peaceful");

      const listed = await listCharacters(db, result.account.id);
      expect(listed.map((character) => character.id)).toContain(summary.id);
    });

    it("rejects duplicate character names case-insensitively across accounts", async () => {
      const first = await register(db);
      const second = await register(db);
      const base = `Name${suffix()}`;
      await createCharacter(db, first.result.account.id, characterInput({ name: base }));
      await expect(
        createCharacter(db, second.result.account.id, characterInput({ name: base.toLowerCase() })),
      ).rejects.toMatchObject({ code: "name_taken" });
    });

    it("enforces four character slots", async () => {
      const { result } = await register(db);
      const prefix = suffix();
      for (let index = 0; index < 4; index++) {
        await createCharacter(
          db,
          result.account.id,
          characterInput({ name: `Slot${index}${prefix}` }),
        );
      }
      await expect(
        createCharacter(db, result.account.id, characterInput({ name: `Fifth${prefix}` })),
      ).rejects.toMatchObject({ code: "slots_full" });
    });

    it("never exceeds four slots under parallel creates", async () => {
      const { result } = await register(db);
      const settled = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          createCharacter(
            db,
            result.account.id,
            characterInput({ name: `Race${index}${suffix()}` }),
          ),
        ),
      );
      expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(4);
      expect(
        settled
          .filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
          .every((entry) => (entry.reason as ServiceError).code === "slots_full"),
      ).toBe(true);

      const rows = await db
        .select()
        .from(characters)
        .where(eq(characters.accountId, result.account.id));
      expect(rows).toHaveLength(4);
    });

    it("resolves same-name races on the unique index without deadlocking", async () => {
      const first = await register(db);
      const second = await register(db);
      const base = `Race${suffix()}`;
      const settled = await Promise.allSettled([
        createCharacter(db, first.result.account.id, characterInput({ name: base })),
        createCharacter(db, second.result.account.id, characterInput({ name: base.toLowerCase() })),
      ]);
      expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
      const rejection = settled.find((entry) => entry.status === "rejected");
      expect(rejection).toBeDefined();
      expect((rejection as PromiseRejectedResult).reason).toMatchObject({ code: "name_taken" });
    });

    it("deletes only the owner's character and blocks deleting an online one", async () => {
      const owner = await register(db);
      const stranger = await register(db);
      const summary = await createCharacter(db, owner.result.account.id, characterInput());

      await expect(
        deleteCharacter(db, stranger.result.account.id, summary.id),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(await db.select().from(characters).where(eq(characters.id, summary.id))).toHaveLength(
        1,
      );

      await expect(
        deleteCharacter(db, owner.result.account.id, summary.id, { isOnline: () => true }),
      ).rejects.toMatchObject({ code: "character_online" });
      expect(await db.select().from(characters).where(eq(characters.id, summary.id))).toHaveLength(
        1,
      );

      await deleteCharacter(db, owner.result.account.id, summary.id);
      expect(await db.select().from(characters).where(eq(characters.id, summary.id))).toHaveLength(
        0,
      );
      expect(await getCharacterForAccount(db, owner.result.account.id, summary.id)).toBeNull();
    });

    it("loads a character only for its owning account", async () => {
      const owner = await register(db);
      const stranger = await register(db);
      const summary = await createCharacter(db, owner.result.account.id, characterInput());
      const loaded = await getCharacterForAccount(db, owner.result.account.id, summary.id);
      expect(loaded?.id).toBe(summary.id);
      expect(await getCharacterForAccount(db, stranger.result.account.id, summary.id)).toBeNull();
    });
  });

  describe("position persistence", () => {
    it("saves position/map, bumps updated_at and reports missing rows", async () => {
      const { result } = await register(db);
      const summary = await createCharacter(db, result.account.id, characterInput());
      const [before] = await db.select().from(characters).where(eq(characters.id, summary.id));

      await new Promise((resolve) => setTimeout(resolve, 5));
      const saved = await saveCharacterPosition(db, summary.id, {
        mapId: "map_ember_fields",
        x: 123.5,
        y: 456.25,
      });
      expect(saved).toBe(true);

      const [after] = await db.select().from(characters).where(eq(characters.id, summary.id));
      expect(after!.mapId).toBe("map_ember_fields");
      expect(after!.x).toBeCloseTo(123.5, 2);
      expect(after!.y).toBeCloseTo(456.25, 2);
      expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());

      await deleteCharacter(db, result.account.id, summary.id);
      expect(
        await saveCharacterPosition(db, summary.id, {
          mapId: "map_ember_village",
          x: 1,
          y: 1,
        }),
      ).toBe(false);
    });

    it("saves several characters in one bulk statement", async () => {
      const { result } = await register(db);
      const prefix = suffix();
      const created = await Promise.all(
        [0, 1, 2].map((index) =>
          createCharacter(db, result.account.id, characterInput({ name: `Bulk${index}${prefix}` })),
        ),
      );

      await saveCharacterPositions(
        db,
        created.map((summary, index) => ({
          characterId: summary.id,
          mapId: "map_ember_fields" as const,
          x: 100 + index,
          y: 200 + index,
        })),
      );

      for (let index = 0; index < created.length; index++) {
        const [row] = await db
          .select()
          .from(characters)
          .where(eq(characters.id, created[index]!.id));
        expect(row!.mapId).toBe("map_ember_fields");
        expect(row!.x).toBeCloseTo(100 + index, 2);
      }

      await expect(saveCharacterPositions(db, [])).resolves.toBeUndefined();
    });
  });
});
