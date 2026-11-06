import express from "express";
import { defineRoom, defineServer } from "@colyseus/core";
import {
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  type MapId,
  type RandomSource,
} from "@jadethrone/shared";
import { config } from "./config";
import { authenticateJoin, type JoinAuthenticator } from "./auth/joinAuth";
import { getAccountById, type AuthDeps } from "./auth/accountService";
import { SessionRegistry } from "./auth/sessionRegistry";
import {
  getCharacterForAccount,
  saveCharacterPosition,
  saveCharacterPositions,
  type BulkPositionSave,
  type PositionSave,
} from "./characters/characterService";
import { getDb, type Db } from "./db/client";
import { consumeWarpTokenPayload } from "./rooms/warpTokens";
import { MapRoom } from "./rooms/MapRoom";
import { errorHandler, notFoundHandler } from "./http/errors";
import type { RateLimitSettings } from "./http/rateLimit";
import { createAuthRouter } from "./routes/auth";
import { createCharactersRouter } from "./routes/characters";
import { healthHandler } from "./routes/health";
import { setServerServices, type CombatTuning } from "./services";
import { createCryptoRandomSource } from "./util/random";

/**
 * Builds the server without listening, so tests can boot it on an ephemeral
 * port (`@colyseus/testing`) and `app.config.ts` can own the real lifecycle.
 *
 * `deps` is a test seam: production passes nothing, so services are always the
 * DB-backed implementations. Rooms created by Colyseus read the installed
 * `ServerServices` (see `services.ts`).
 */
export interface ServerDeps {
  db?: Db;
  authDeps?: AuthDeps;
  sessionRegistry?: SessionRegistry;
  joinAuthenticator?: JoinAuthenticator;
  savePosition?: (characterId: string, save: PositionSave) => Promise<boolean>;
  savePositions?: (saves: ReadonlyArray<BulkPositionSave>) => Promise<void>;
  createRandomSource?: () => RandomSource;
  combatTuning?: CombatTuning;
  rateLimits?: {
    register?: RateLimitSettings;
    login?: RateLimitSettings;
    refresh?: RateLimitSettings;
  };
}

function defaultJoinAuthenticator(db: Db, accessSecret: string): JoinAuthenticator {
  return (token, options, context) =>
    authenticateJoin(
      {
        accessSecret,
        getAccountById: (accountId) => getAccountById(db, accountId),
        getCharacterForAccount: (accountId, characterId) =>
          getCharacterForAccount(db, accountId, characterId),
        consumeWarpToken: (warpToken, map: MapId) => consumeWarpTokenPayload(warpToken, map),
      },
      token,
      options,
      context,
    );
}

export function createGameServer(deps: ServerDeps = {}) {
  const db = deps.db ?? getDb();
  const authDeps =
    deps.authDeps ??
    ({
      db,
      accessSecret: config.jwtAccessSecret,
      refreshSecret: config.jwtRefreshSecret,
      accessTtlSeconds: config.jwtAccessTtlSeconds,
      refreshTtlSeconds: config.jwtRefreshTtlSeconds,
    } satisfies AuthDeps);
  const sessionRegistry = deps.sessionRegistry ?? new SessionRegistry();
  const joinAuthenticator =
    deps.joinAuthenticator ?? defaultJoinAuthenticator(db, authDeps.accessSecret);
  const savePosition =
    deps.savePosition ?? ((characterId, save) => saveCharacterPosition(db, characterId, save));
  const savePositions = deps.savePositions ?? ((saves) => saveCharacterPositions(db, saves));

  setServerServices({
    db,
    authDeps,
    joinAuthenticator,
    sessionRegistry,
    savePosition,
    savePositions,
    createRandomSource: deps.createRandomSource ?? createCryptoRandomSource,
    combatTuning: deps.combatTuning ?? {},
  });

  return defineServer({
    rooms: {
      [ROOM_NAME_VILLAGE]: defineRoom(MapRoom),
      [ROOM_NAME_FIELDS]: defineRoom(MapRoom),
    },
    express: (app) => {
      app.disable("x-powered-by");
      app.get("/api/health", healthHandler);

      // Scoped to /api: Colyseus owns the matchmaking/WebSocket routes and its
      // own body handling, so it must not see these middleware.
      app.use("/api", express.json({ limit: "32kb" }));
      app.use(
        "/api/auth",
        createAuthRouter({ authDeps, db, sessionRegistry, rateLimits: deps.rateLimits }),
      );
      app.use("/api/characters", createCharactersRouter({ authDeps, db, sessionRegistry }));
      app.use("/api", notFoundHandler);
      app.use(errorHandler);
    },
  });
}
