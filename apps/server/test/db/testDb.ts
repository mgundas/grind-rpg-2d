import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import type { Db } from "../../src/db/client";

/**
 * Dedicated test database. Refuses to touch a database whose URL does not look
 * like a test database, so a stray `TEST_DATABASE_URL` can never truncate a
 * development or production database.
 */
export function hasTestDatabase(): boolean {
  return Boolean(process.env.TEST_DATABASE_URL);
}

export interface TestDb {
  db: Db;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set");
  }
  if (!/test/i.test(url)) {
    throw new Error("Refusing to run database tests against a URL without 'test' in it");
  }

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000, max: 10 });
  const db = drizzle(pool, { schema });
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  await migrate(db, { migrationsFolder });
  return { db, close: () => pool.end() };
}
