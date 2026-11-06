import { existsSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb } from "./client";

/**
 * Resolve the committed `drizzle/` folder in both run contexts we have:
 * `pnpm --filter @jadethrone/server …` (cwd = apps/server) and vitest from the
 * repo root. The server production bundle is not responsible for shipping the
 * folder; deployment runs from the server package (see DECISIONS.md D26).
 */
export function findMigrationsFolder(): string {
  const candidates = [
    process.env.DRIZZLE_MIGRATIONS_DIR,
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(process.cwd(), "apps/server/drizzle"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return candidate;
    }
  }
  throw new Error(
    `Drizzle migrations folder not found (looked in: ${candidates.join(", ")}). ` +
      "Run `pnpm db:generate` first or set DRIZZLE_MIGRATIONS_DIR.",
  );
}

/** Apply every committed migration. Idempotent; used by boot, CLI and tests. */
export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: findMigrationsFolder() });
}
