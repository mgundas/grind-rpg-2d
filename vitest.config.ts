import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    // Phase 1: convert to a `projects` configuration when server room tests
    // (@colyseus/testing) and client tests join the suite.
  },
});
