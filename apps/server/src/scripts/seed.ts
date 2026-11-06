import process from "node:process";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { config } from "../config";
import { getDb, closeDb } from "../db/client";
import { accounts } from "../db/schema";
import { hashPassword } from "../auth/passwords";
import { createCharacter, listCharacters } from "../characters/characterService";
import { logger } from "../logger";

/**
 * Idempotent seed: an admin account (GAME_DESIGN.md §10.3) and, outside
 * production, a test player with one character. Re-running is safe: existing
 * emails are skipped and no duplicate characters are created.
 *
 * Run with `pnpm seed` (loads the repo `.env`).
 */
interface SeedAccount {
  email: string;
  username: string;
  password: string;
  role: "admin" | "player";
  characterName: string;
}

async function ensureAccount(seed: SeedAccount): Promise<{ accountId: string; created: boolean }> {
  const db = getDb();
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(sql`lower(${accounts.email}) = ${seed.email.toLowerCase()}`)
    .limit(1);
  if (existing) {
    return { accountId: existing.id, created: false };
  }

  const accountId = randomUUID();
  await db.insert(accounts).values({
    id: accountId,
    email: seed.email,
    username: seed.username,
    passwordHash: await hashPassword(seed.password),
    kingdom: "ember",
    role: seed.role,
    tokenVersion: 0,
  });
  return { accountId, created: true };
}

async function ensureCharacter(accountId: string, name: string): Promise<void> {
  const db = getDb();
  const existing = await listCharacters(db, accountId);
  if (existing.length > 0) {
    logger.info({ accountId, character: existing[0]!.name }, "seed character already exists");
    return;
  }
  const character = await createCharacter(db, accountId, {
    name,
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 0,
  });
  logger.info({ accountId, character: character.name }, "seed character created");
}

async function main(): Promise<void> {
  const admin = await ensureAccount({
    email: config.seedAdminEmail,
    username: "Admin",
    password: config.seedAdminPassword,
    role: "admin",
    characterName: "GameMaster",
  });
  logger.info({ email: config.seedAdminEmail, created: admin.created }, "seed admin");
  await ensureCharacter(admin.accountId, "GameMaster");

  if (process.env.NODE_ENV !== "production") {
    const test = await ensureAccount({
      email: config.seedTestEmail,
      username: config.seedTestUsername,
      password: config.seedTestPassword,
      role: "player",
      characterName: "Grinder",
    });
    logger.info({ email: config.seedTestEmail, created: test.created }, "seed test player");
    await ensureCharacter(test.accountId, "Grinder");
  }
}

void main()
  .then(() => {
    console.log("[seed] done");
  })
  .catch((error: unknown) => {
    console.error("[seed] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDb();
  });
