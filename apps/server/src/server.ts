import { defineRoom, defineServer } from "@colyseus/core";
import { ROOM_NAME_FIELDS, ROOM_NAME_VILLAGE } from "@jadethrone/shared";
import { MapRoom } from "./rooms/MapRoom";
import { healthHandler } from "./routes/health";

/**
 * Builds the server without listening, so tests can boot it on an ephemeral
 * port (`@colyseus/testing`) and `app.config.ts` can own the real lifecycle.
 */
export function createGameServer() {
  return defineServer({
    rooms: {
      [ROOM_NAME_VILLAGE]: defineRoom(MapRoom),
      [ROOM_NAME_FIELDS]: defineRoom(MapRoom),
    },
    express: (app) => {
      app.get("/api/health", healthHandler);
    },
  });
}
