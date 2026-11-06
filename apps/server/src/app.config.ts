import process from "node:process";
import { matchMaker } from "@colyseus/core";
import { config } from "./config";
import { runMigrations } from "./db/migrate";
import { logger } from "./logger";
import { createGameServer } from "./server";
import { getServerServices } from "./services";

/**
 * The `@colyseus/core` typings were verified against 0.17.56 before writing
 * this entrypoint: `defineServer({ rooms, express })` wires the WebSocket
 * transport (auto-detected from our @colyseus/ws-transport dependency) and
 * gives us the Express app for our REST routes. See DECISIONS.md D1/D6.
 *
 * `server.listen(...)` is chained (not awaited at top level) because the
 * production bundle is CJS, which cannot use top-level await (D8).
 */
const server = createGameServer();

if (config.usingDefaultDbPassword) {
  logger.warn("POSTGRES_PASSWORD is not configured; using the built-in dev default.");
}

const DEV_JWT_SECRETS = new Set([
  "dev-only-jade-throne-access-secret-change-me",
  "dev-only-jade-throne-refresh-secret-change-me",
  "change-me",
]);
if (DEV_JWT_SECRETS.has(config.jwtAccessSecret) || DEV_JWT_SECRETS.has(config.jwtRefreshSecret)) {
  if (process.env.NODE_ENV === "production") {
    logger.error("JWT secrets are dev placeholders; refusing to start in production.");
    process.exit(1);
  }
  logger.warn("JWT secrets are dev placeholders; set JWT_ACCESS_SECRET/JWT_REFRESH_SECRET.");
}

// Migrations are applied in the background so an unreachable database never
// prevents the HTTP health endpoint from answering. Auth/character routes
// return 503 until the tables exist (see DECISIONS.md D26).
void runMigrations()
  .then(() => logger.info("database migrations applied"))
  .catch((error: unknown) => logger.error({ error }, "database migrations failed"));

server
  .listen(config.port)
  .then(() => {
    // The transport only exists after listen(); simulateLatency() dereferences
    // it, so this must run here rather than before listen().
    if (config.simulateLatencyMs > 0) {
      server.simulateLatency(config.simulateLatencyMs);
      logger.info(
        { latencyMs: config.simulateLatencyMs },
        "simulating network latency in both directions",
      );
    }
    getServerServices().adminRuntime.start();
    logger.info(`Jade Throne game server listening on port ${config.port}`);
    logger.info({ rooms: Object.keys(matchMaker.getAllHandlers()) }, "rooms registered");
  })
  .catch((error: unknown) => {
    logger.error({ error }, "Failed to start the game server");
    process.exit(1);
  });
