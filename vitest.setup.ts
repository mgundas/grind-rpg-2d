import process from "node:process";

/**
 * Vitest global setup. Runs before any test module (and therefore before the
 * server's `config.ts` is imported).
 *
 * - When `TEST_DATABASE_URL` is set, point the server's lazy DB client at the
 *   same test database. The URL must look like a test database: the DB suite
 *   refuses to touch anything else.
 * - Use deterministic JWT secrets and quiet logs so test output stays readable.
 */
const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) {
  if (!/test/i.test(testUrl)) {
    throw new Error("TEST_DATABASE_URL must contain 'test' (refusing to run against dev data)");
  }
  process.env.DATABASE_URL ??= testUrl;
}

process.env.JWT_ACCESS_SECRET ??= "test-access-secret-at-least-32-characters";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-32-characters";

if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = "error";
}
