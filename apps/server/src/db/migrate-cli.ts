import { closeDb } from "./client";
import { runMigrations } from "./migrate";

/** `pnpm db:migrate` entrypoint. */
async function main(): Promise<void> {
  try {
    await runMigrations();
    console.log("[db] migrations applied");
  } catch (error) {
    console.error("[db] migration failed:", error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

void main();
