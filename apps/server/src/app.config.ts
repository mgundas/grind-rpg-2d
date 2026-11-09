import process from "node:process";
import { matchMaker } from "@colyseus/core";
import { config } from "./config";
import { closeDb } from "./db/client";
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
const isProduction = process.env.NODE_ENV === "production";

const DEV_JWT_SECRETS = new Set([
  "dev-only-jade-throne-access-secret-change-me",
  "dev-only-jade-throne-refresh-secret-change-me",
  "change-me",
]);

function assertProductionConfig(): void {
  if (!isProduction) {
    if (DEV_JWT_SECRETS.has(config.jwtAccessSecret) || DEV_JWT_SECRETS.has(config.jwtRefreshSecret)) {
      logger.warn("JWT secrets are dev placeholders; set JWT_ACCESS_SECRET/JWT_REFRESH_SECRET.");
    }
    if (config.usingDefaultDbPassword) {
      logger.warn("POSTGRES_PASSWORD is not configured; using the built-in dev default.");
    }
    return;
  }

  const problems: string[] = [];
  if (DEV_JWT_SECRETS.has(config.jwtAccessSecret) || config.jwtAccessSecret.length < 32) {
    problems.push("JWT_ACCESS_SECRET must be a random value of at least 32 characters");
  }
  if (DEV_JWT_SECRETS.has(config.jwtRefreshSecret) || config.jwtRefreshSecret.length < 32) {
    problems.push("JWT_REFRESH_SECRET must be a random value of at least 32 characters");
  }
  if (config.usingDefaultDbPassword) {
    problems.push("POSTGRES_PASSWORD must not be the dev default");
  }
  if (problems.length > 0) {
    for (const problem of problems) {
      logger.error(problem);
    }
    logger.error("Refusing to start in production with placeholder secrets.");
    process.exit(1);
  }
}

assertProductionConfig();

async function reloadGameData(): Promise<void> {
  try {
    const result = await getServerServices().gameData.reload();
    logger.info({ version: result.version, overrides: result.overrides }, "game data loaded");
  } catch (error) {
    logger.error({ error }, "game data reload failed; serving base data");
  }
}

/**
 * Production applies migrations before listening so a broken schema fails fast.
 * Development keeps the original background path: the health endpoint answers
 * while an unreachable database is retried on the next boot.
 */
async function applyMigrations(): Promise<void> {
  if (isProduction) {
    await runMigrations();
    logger.info("database migrations applied");
    await reloadGameData();
    return;
  }
  void runMigrations()
    .then(() => logger.info("database migrations applied"))
    .then(reloadGameData)
    .catch((error: unknown) => logger.error({ error }, "database migrations failed"));
}

function registerShutdownHandlers(): void {
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "graceful shutdown started");
    try {
      const rooms = getServerServices().adminBus.roomHandles();
      await Promise.allSettled(rooms.map((room) => room.saveAllForShutdown()));
      getServerServices().adminBus.broadcastAnnouncement({
        message: "Server is shutting down. Your progress has been saved.",
        kind: "shutdown",
        sentAtMs: Date.now(),
      });
      await server.gracefullyShutdown(false);
    } catch (error) {
      logger.error({ error }, "graceful shutdown failed");
    }
    try {
      await closeDb();
    } catch {
      // The pool may already be closed by the Colyseus teardown.
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

registerShutdownHandlers();

async function start(): Promise<void> {
  if (isProduction) {
    // Fail fast: migrations must succeed before the port opens.
    await applyMigrations();
  } else {
    void applyMigrations();
  }

  await server.listen(config.port);
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
}

void start().catch((error: unknown) => {
  logger.error({ error }, "Failed to start the game server");
  process.exit(1);
});
