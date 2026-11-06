import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // DB-backed tests migrate the test database and run argon2 concurrently.
    testTimeout: 20_000,
    // Phase 1: client and server room suites are included. Phase 3 may convert
    // this to a `projects` configuration when suites need different envs.
  },
});
