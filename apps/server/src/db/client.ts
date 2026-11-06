import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config";
import * as schema from "./schema";

/**
 * Lazily-created Postgres pool + Drizzle instance. Importing this module never
 * opens a connection, so the server can boot (and `/api/health` can answer)
 * while the database is unreachable; auth/character routes surface 503.
 */
let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

export type Db = NodePgDatabase<typeof schema>;
/** Exact transaction-callback client type; keeps services inference-safe. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function getPool(): Pool {
  pool ??= new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10_000,
    max: 10,
  });
  return pool;
}

export function getDb(): Db {
  db ??= drizzle(getPool(), { schema });
  return db;
}

/** Close the pool (CLI scripts and test teardown). Safe to call repeatedly. */
export async function closeDb(): Promise<void> {
  const current = pool;
  pool = null;
  db = null;
  if (current) {
    await current.end();
  }
}
