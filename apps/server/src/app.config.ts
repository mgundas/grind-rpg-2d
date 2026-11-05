import process from "node:process";
import { defineServer } from "@colyseus/core";
import { config } from "./config";
import { logger } from "./logger";
import { healthHandler } from "./routes/health";

/**
 * The `@colyseus/core` typings were verified against 0.17.56 before writing
 * this entrypoint: `defineServer({ rooms, express })` wires the WebSocket
 * transport (auto-detected from our @colyseus/ws-transport dependency) and
 * gives us the Express app for our REST routes. See DECISIONS.md D1/D6.
 *
 * `server.listen(...)` is chained (not awaited at top level) because the
 * production bundle is CJS, which cannot use top-level await (D8).
 */
const server = defineServer({
  rooms: {
    // The world room is registered in the next task; matchmaking untested
    // until then.
  },
  express: (app) => {
    app.get("/api/health", healthHandler);
  },
});

if (config.usingDefaultDbPassword) {
  logger.warn("POSTGRES_PASSWORD is not configured; using the built-in dev default.");
}

server
  .listen(config.port)
  .then(() => {
    logger.info(`Jade Throne game server listening on port ${config.port}`);
  })
  .catch((error: unknown) => {
    logger.error({ error }, "Failed to start the game server");
    process.exit(1);
  });
