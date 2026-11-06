import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit is only used to generate SQL migrations from `src/db/schema.ts`.
 * Applying them is done by `src/db/migrate.ts` (and again on server boot), so
 * this config never needs a reachable database for `db:generate`.
 *
 * See DECISIONS.md D23.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://jade:jade_dev@localhost:5432/jade_throne",
  },
  strict: false,
  verbose: true,
});
