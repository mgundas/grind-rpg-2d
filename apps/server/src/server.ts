import express from "express";
import { defineRoom, defineServer } from "@colyseus/core";
import { monitor } from "@colyseus/monitor";
import {
  MAP_IDS,
  type MapId,
  type RandomSource,
} from "@jadethrone/shared";
import { config } from "./config";
import { authenticateJoin, type JoinAuthenticator } from "./auth/joinAuth";
import { getAccountById, type AuthDeps } from "./auth/accountService";
import { SessionRegistry } from "./auth/sessionRegistry";
import {
  getCharacterForAccount,
  saveCharacterState,
  saveCharacterStates,
  type BulkCharacterSave,
  type CharacterSave,
} from "./characters/characterService";
import {
  saveSkillState as saveSkillStateDb,
  type SkillStateChange,
} from "./characters/characterSkills";
import { getDb, type Db } from "./db/client";
import type { CharacterRecord } from "./characters/characterMappers";
import { checkWarpToken } from "./rooms/warpTokens";
import { MapRoom } from "./rooms/MapRoom";
import { requireAdminCookie } from "./http/adminCookie";
import { errorHandler, notFoundHandler } from "./http/errors";
import type { RateLimitSettings } from "./http/rateLimit";
import { createAdminRouter } from "./routes/admin";
import { createAuthRouter } from "./routes/auth";
import { createCharactersRouter } from "./routes/characters";
import { createDataRouter } from "./routes/data";
import { healthHandler } from "./routes/health";
import { randomUUID } from "node:crypto";
import { writeAdminLog, type AdminLogInput } from "./admin/adminLog";
import { createAdminRuntime, type AdminRuntime } from "./admin/adminRuntime";
import { createAdminBus, type AdminBus } from "./admin/liveBus";
import { chatLog } from "./db/schema";
import { createItemService, type ItemService } from "./items/service";
import { setServerServices, type ChatLogInput, type CombatTuning } from "./services";
import { createDbGameDataStore } from "./gameData/dbStore";
import type { GameDataStore } from "./gameData/store";
import { createSocialDirectory } from "./social/bus";
import { createPartyRegistry } from "./rooms/party";
import { createGuildInviteRegistry } from "./social/guildInvites";
import type { SocialDirectory } from "./social/bus";
import type { PartyRegistry } from "./rooms/party";
import { createGuildService } from "./guilds/service";
import type { GuildService } from "./guilds/service";
import { createFriendsService } from "./friends/service";
import { setCharacterPvpMode } from "./characters/pvp";
import type { PvpMode } from "@jadethrone/shared";
import type { FriendsService } from "./friends/service";
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
  saveCharacter?: (characterId: string, save: CharacterSave) => Promise<boolean>;
  saveCharacters?: (saves: ReadonlyArray<BulkCharacterSave>) => Promise<void>;
  loadCharacter?: (accountId: string, characterId: string) => Promise<CharacterRecord | null>;
  saveSkillState?: (characterId: string, change: SkillStateChange) => Promise<boolean>;
  items?: ItemService;
  gameData?: GameDataStore;
  social?: SocialDirectory;
  parties?: PartyRegistry;
  guilds?: GuildService;
  friends?: FriendsService;
  setPvpMode?: (characterId: string, mode: PvpMode) => Promise<boolean>;
  adminBus?: AdminBus;
  adminRuntime?: AdminRuntime;
  logChat?: (entry: ChatLogInput) => Promise<void>;
  logAdminAction?: (entry: AdminLogInput) => Promise<void>;
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
        checkWarpToken: (warpToken, map: MapId) => checkWarpToken(warpToken, map),
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
  const saveCharacter =
    deps.saveCharacter ?? ((characterId, save) => saveCharacterState(db, characterId, save));
  const saveCharacters = deps.saveCharacters ?? ((saves) => saveCharacterStates(db, saves));
  const loadCharacter =
    deps.loadCharacter ??
    ((accountId, characterId) => getCharacterForAccount(db, accountId, characterId));
  const saveSkillState =
    deps.saveSkillState ?? ((characterId, change) => saveSkillStateDb(db, characterId, change));
  const itemService = deps.items ?? createItemService(db);
  const gameData = deps.gameData ?? createDbGameDataStore(db);
  const social = deps.social ?? createSocialDirectory();
  const parties = deps.parties ?? createPartyRegistry();
  const guildInvites = createGuildInviteRegistry();
  const guilds = deps.guilds ?? (deps.joinAuthenticator ? null : createGuildService(db));
  const friends = deps.friends ?? (deps.joinAuthenticator ? null : createFriendsService(db));
  const setPvpMode =
    deps.setPvpMode ??
    (deps.joinAuthenticator ? null : (characterId: string, mode: PvpMode) =>
      setCharacterPvpMode(db, characterId, mode));
  const adminBus = deps.adminBus ?? createAdminBus();
  const adminRuntime =
    deps.adminRuntime ?? createAdminRuntime({ db, bus: adminBus });
  const logAdminAction = async (entry: AdminLogInput): Promise<void> => {
    await writeAdminLog(db, entry);
  };
  const logChat = async (entry: ChatLogInput): Promise<void> => {
    try {
      await db.insert(chatLog).values({
        id: randomUUID(),
        characterId: entry.characterId,
        name: entry.name,
        kingdom: entry.kingdom,
        mapId: entry.mapId,
        channel: entry.channel,
        chatText: entry.text,
      });
    } catch {
      // Chat logging must never break delivery.
    }
  };

  setServerServices({
    db,
    authDeps,
    joinAuthenticator,
    sessionRegistry,
    saveCharacter,
    saveCharacters,
    loadCharacter,
    saveSkillState,
    items: itemService,
    gameData,
    social,
    parties,
    guilds,
    friends,
    setPvpMode,
    guildInvites,
    adminBus,
    adminRuntime,
    logChat: deps.logChat ?? logChat,
    logAdminAction: deps.logAdminAction ?? logAdminAction,
    createRandomSource: deps.createRandomSource ?? createCryptoRandomSource,
    combatTuning: deps.combatTuning ?? {},
  });

  const server = defineServer({
    rooms: Object.fromEntries(
      MAP_IDS.map((mapId) => [mapId, defineRoom(MapRoom).filterBy(["channel"])]),
    ),
    express: (app) => {
      app.disable("x-powered-by");
      app.get("/api/health", healthHandler);

      // The monitor iframe cannot send a bearer header; the admin login cookie
      // authenticates its HTML and asset requests.
      app.use("/colyseus", requireAdminCookie({ authDeps }), monitor());

      // Scoped to /api: Colyseus owns the matchmaking/WebSocket routes and its
      // own body handling, so it must not see these middleware.
      app.use("/api", express.json({ limit: "32kb" }));
      app.use(
        "/api/auth",
        createAuthRouter({ authDeps, db, sessionRegistry, rateLimits: deps.rateLimits }),
      );
      app.use("/api/characters", createCharactersRouter({ authDeps, db, sessionRegistry }));
      app.use(
        "/api/admin",
        createAdminRouter({
          db,
          authDeps,
          sessionRegistry,
          adminBus,
          adminRuntime,
          gameData,
        }),
      );
      app.use("/api/data", createDataRouter({ gameData }));
      app.use("/api", notFoundHandler);
      app.use(errorHandler);
    },
  });
  adminRuntime.attachServer(server);
  return server;
}
