# Jade Throne — Phase 2 (Accounts and characters) — Builder Handoff

Phase 1 is complete (`docs/reports/phase-1.md`). This plan was produced after reading `AGENTS.md`, `GAME_DESIGN.md` (§4, §10.2, §10.3, §12), `PROGRESS.md`, `DECISIONS.md`, the current code, and the installed/prospective library typings.

**Scope (GAME_DESIGN §12):** register/login REST API, JWT, argon2, kingdom choice, character create/select/delete with LPC-style layered placeholder appearance, character saved and loaded (position, map), one session per account, logout, React login and character select screens styled per §2.

**Acceptance:** register, create a character, walk, log out, log in, character is where it was. Second login kicks the first session.

**Out of scope (do not build):** combat and real stats beyond creation, items/inventory, shops, channel selection (store `channel = 1`), admin panel, guilds, PvP, reconnect tokens, password reset/email verification, real art, CORS, load tests.

---

## 1. What already exists that Phase 2 builds on

### Server (`apps/server`)

- `src/server.ts` — `createGameServer()` returns `defineServer({ rooms, express })`; the single mounting point for REST routes and room registrations.
- `src/rooms/MapRoom.ts` (504 lines) — anonymous guest join (`joinOptionsSchema` accepts `name`, `kingdom`, `warpToken`), 20 Hz authoritative movement, chat, StateView interest (850/900 px), warp via `matchMaker.joinOrCreate` + single-use warp tokens.
- `src/rooms/state/WorldState.ts` — `PlayerState { name, kingdom, x, y, facing, moving, lastSeq }` in a `@view()`-tagged `players` MapSchema. No character id, class, appearance, level or account linkage.
- `src/rooms/playerRuntime.ts` — server-private per-player movement/cooldown state.
- `src/rooms/warpTokens.ts` — in-memory single-use 30 s tokens for map changes.
- `src/maps/mapRegistry.ts` — parsed map assets (`grid`, `warps`, `spawn`, bounds).
- `src/routes/health.ts` — the only Express route today; `pg` is used only for the health ping.
- `src/config.ts` — Zod-validated env: `DATABASE_URL` from `POSTGRES_*`, but no JWT config.
- `src/app.config.ts` — listen/latency/bootstrap.
- `apps/server/package.json` — no Drizzle, argon2 or JWT. `pg`, `express`, `pino`, `zod` are present.

### Shared / data

- `packages/shared` — movement, collision, pathfinding, Tiled parser, chat, protocol Zod schemas, constants, seeded RNG.
- `packages/shared/src/protocol.ts` — `MSG`, input/chat schemas, `ChatMsgPayload`, `WarpPayload`.
- `packages/data` — generated Tiled maps only; no class/item/monster JSON.
- `packages/shared/src/formulas.ts` does **not** exist yet.

### Client (`apps/client`)

- `src/network/session.ts` — SDK singleton, `connect({ name, kingdom })`, warp consumption, ping loop.
- `src/ui/JoinPanel.tsx` — Phase-1 guest join (name + kingdom); `App.tsx` renders it over the canvas.
- `src/scenes/World.ts` — map render, own predictor, remote interpolation, chat bubbles, warp; own sprite texture is hardcoded to `char.body.male`; remotes use the same texture.
- `src/assets/placeholders.ts` + `manifest.json` — procedural placeholder system (`char`, `mob`, `icon`, `tileset`, `portrait`); one flat character texture.
- Zustand `ui/store.ts` — connection phase, session id, map id, chat, debug stats. No auth/character state.
- Tests: predictor, interpolation, manifest; server room tests (601 lines) all join anonymously.

### Infra

- No Drizzle, migrations, auth, sessions, character tables, or seed script.
- `.env.example` already reserves `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.
- CI has **no** Postgres service yet (explicit Phase-2 TODO comment).
- `scripts/verify-phase1-e2e.mjs` and `scripts/smoke-server.mjs` both assume anonymous joins and must be updated.

### Colyseus 0.17 facts verified in the installed typings/runtime

These dictated the design:

- **Authentication must be a `static onAuth`.** `MatchMaker.mjs` calls `roomClass["onAuth"](authContext.token, options, authContext)` during matchmaking and stores the return value as the seat reservation's auth data; `Room._onJoin` then assigns it to `client.auth`. An instance-only `onAuth` runs later during the WS join and is ignored if a static one exists (`defineRoomType` logs a warning). Static auth is what allows a bad token to fail the HTTP matchmake request cleanly and lets warp reservations carry identity.
- `client.auth.token = jwt` in `@colyseus/sdk` sets `http.authToken`, which sends `Authorization: Bearer …` on matchmake and `_authToken=…` on the WebSocket URL; `ws-transport` turns that into `context.token`.
- `matchMaker.joinOrCreate(roomName, options, authContext)` accepts an `AuthContext`. **Once MapRoom gains a static `onAuth`, warp reservations must pass a third argument** (or `callOnAuth` dereferences `undefined.token`). This is a Phase-1 breakage risk to handle explicitly.
- Server `client.leave(code)` exists; application close codes 4000–4010 are reserved, so use **4100** for "session replaced".
- `@colyseus/testing` `boot(createGameServer())` uses port 2568 by default, exposes `colyseus.sdk` (so `colyseus.sdk.auth.token = …` works) and `colyseus.http` for REST tests.
- `@node-rs/argon2@2.2.2` exports `hash(password, options?)`, `verify(hash, password)`, `Algorithm.Argon2id`; defaults are Argon2id, m=19456, t=2, p=1 (verified from the published `.d.ts`).
- `drizzle-orm@0.45.4` `drizzle(pool)` / `migrate(db, { migrationsFolder })` from `drizzle-orm/node-postgres` and `.../migrator`; `drizzle-kit@0.31.11` `defineConfig({ dialect: "postgresql", schema, out, dbCredentials })` (verified from published `.d.ts`; re-verify installed typings in task 1).
- Zod 4.6.7 provides top-level `z.email()` / `z.uuid()`; Express 5 forwards rejected async handlers to the error middleware.

---

## 2. Architecture for Phase 2

### 2.1 Identity and session model

- `accounts` own `characters` (max 4) and a kingdom. `characters` store everything needed to rejoin.
- Access token: JWT HS256, 1 h, claims `{ sub: accountId, tv: tokenVersion, typ: "access", iss: "jade-throne" }`.
- Refresh token: JWT HS256, 30 days, claims `{ sub, sid, typ: "refresh" }`; only its SHA-256 hash is stored in `sessions`. Rotation on every refresh.
- **One active session per account:**
  - Every successful login increments `accounts.token_version`, revokes all prior refresh sessions, and calls an in-process `SessionRegistry.kickAccount(accountId)`.
  - The registry holds `accountId / characterId / sessionId / room / client`. Kick = best-effort save of the current authoritative position, send `sessionKicked` message, then `client.leave(4100)`.
  - Static `onAuth` verifies `claims.tv === account.token_version`, so old access tokens can never rejoin.
  - `onJoin` also registers the session; a duplicate join (same token, second tab) kicks the previous session, but saves it first.
- Logout revokes the refresh session, increments `token_version`, clears the registry entry and leaves the room.

### 2.2 Join flow (initial join and warp)

1. Client `POST /api/auth/login` → tokens + characters.
2. Client sets `sdk.auth.token = accessToken`, then `joinOrCreate(character.map, { characterId, map: character.map })`.
3. Static `MapRoom.onAuth(token, options, context)`:
   - parses options (`characterId`, `map`, optional `warpToken`),
   - if `warpToken` is present: validates the server-issued token (single-use, 30 s, map + account + character binding) and loads the character; **no JWT required** (this is how warps survive access-token expiry),
   - otherwise verifies the JWT, token version, ban state,
   - loads the character by id and verifies `account_id === sub` and `character.map === options.map`,
   - returns a safe `{ account, character }` object (never the password hash).
4. `MapRoom.onJoin` uses `client.auth.character` — never the client-supplied name/kingdom/position — and builds `PlayerState`.

### 2.3 Persistence policy

- Save only the server-authoritative position/map: on leave, immediately before a warp reservation, and every 60 s for dirty players.
- `runtime.dirty` is set when a tick changes position; a successful save clears it.
- On join, the saved position is validated with `nearestWalkable` against the room's collision grid; invalid positions fall back to the map spawn and are marked dirty.
- Warp: save destination position/map **first**, then reserve; if the reservation fails, restore the player in the room and re-save the source position best-effort.
- A kicked session is saved before the socket is closed and its `dirty` flag is cleared, so the subsequent `onLeave` does not overwrite a newer session with stale data.
- DB errors never crash the room tick: log, keep `dirty`, retry on the next save.

### 2.4 Database (Drizzle, PostgreSQL)

Tables for this phase (unused spec tables such as items/guilds/logs stay for later phases):

- `accounts`: `id uuid pk`, `email` (lower-cased), `username`, `password_hash`, `kingdom`, `role` (`player|gm|admin`), `token_version int`, `banned_until timestamptz null`, `ban_reason`, `created_at`, `last_login`.
- `characters`: `id uuid pk`, `account_id` FK cascade, `name`, `class_id`, `doctrine` (nullable), `gender`, `hair_style smallint`, `hair_color smallint`, `level`, `xp bigint`, `gold bigint`, `hp`, `mp`, `stat_vit/int/str/dex`, `stat_points`, `skill_points`, `map_id`, `x real`, `y real`, `channel`, `pvp_mode`, `playtime_seconds`, `created_at`, `updated_at`.
- `sessions`: `id uuid pk` (`sid`), `account_id`, `token_hash unique`, `expires_at`, `created_at`, `revoked_at null`, `ip`, `user_agent`.
- Case-insensitive uniqueness via `uniqueIndex(...).on(sql\`lower(${t.email})\`)` and the same for username and character name. UUIDs are generated in the application (`crypto.randomUUID()`), not by the DB.
- Character creation uses a transaction with `SELECT id FROM accounts WHERE id = $1 FOR UPDATE` then a count, so concurrent requests cannot exceed 4 slots; the DB unique index is the final arbiter for names (map PG `23505` to 409).

### 2.5 Layered character appearance

- Appearance is data: `classId` from `packages/data/classes.json`, `gender` (`male|female`), `hairStyle` 0–2, `hairColor` 0–2.
- A client-only layered canvas draw (`body → legs → torso/class outfit → head → hair`) produces a composite texture keyed by `char.gen.<class>.<gender>.<hairStyle>.<hairColor>`; the same drawing function backs the React character preview.
- Server `PlayerState` carries `characterId`, `classId`, `gender`, `hairStyle`, `hairColor`, `level` so other clients render the correct appearance.
- All class colours/name/stat data live in `classes.json`, not in components.

### 2.6 Task list

Every task ends with `pnpm typecheck`, the relevant tests, `pnpm lint`, a `PROGRESS.md` tick, and one commit. The client can be temporarily unable to join between the server-auth commit and the client-auth commit — that is expected mid-phase.

1. **Dependencies, config, DB schema, migration** — catalogs/server deps; `drizzle.config.ts`; `src/db/{schema,client,migrate}.ts`; `src/config.ts` JWT config; generated `drizzle/0000_*.sql`; `.env.example`; root/server scripts.
2. **Shared rules, DTOs, class data, HP/MP formulas, new WS messages** — `characterRules.ts`, `auth.ts`, `formulas.ts`, protocol additions, `KINGDOM_IDS`, `packages/data/classes.json` + typed loader, tests.
3. **Password hashing and JWT helpers** — `auth/passwords.ts`, `auth/tokens.ts`, claims schemas, tests.
4. **Account and character services (DB)** — `db/errors.ts`, `auth/accountService.ts`, `characters/{characterService,spawn}.ts`, test DB helper, DB-backed test file.
5. **Session registry, warp token extension, static join authenticator** — `auth/sessionRegistry.ts`, extended `warpTokens.ts`, `auth/joinAuth.ts`, `services.ts`, static `MapRoom.onAuth`, tests.
6. **REST routes, middleware, server dependency wiring** — `http/{errors,rateLimit,requireAuth}.ts`, `routes/{auth,characters}.ts`, `server.ts` deps, tests.
7. **MapRoom: authenticated join, state identity, persistence, kick** — schema/runtime fields, onJoin/onLeave/autosave/save, room tests rewrite.
8. **Warp persistence and target-map authentication** — startWarp/reserveSeat, warp tests.
9. **Client API + token storage + auth state** — `network/{tokens,api}.ts`, store auth slice, tests.
10. **Client session and screen routing** — session connect/retry/kick/logout, App routing, remove `JoinPanel`.
11. **Auth screen** — theme components, login/register with kingdom choice, boot token restore.
12. **Character select, create, delete, preview** — `CharacterSelect`, `CreateCharacter`, `CharacterPreview`, character art/keys, tests.
13. **Layered appearance in the world** — World own/remote textures, map restart, remotes data.
14. **In-game logout and kick UX** — menu/logout, kick reason handling, warp guard.
15. **Seed script and verification tooling** — `src/scripts/seed.ts`, `verify-phase2-e2e.mjs`, update Phase-1 e2e/smoke.
16. **CI Postgres, docs, final verification** — CI service, `vitest.setup.ts`, README/ASSETS/env, `@reviewer`, phase report.

---

## 3. Hard-system detail and edge cases

### Auth / REST

- Never log passwords, tokens, or password hashes; log security events with account id + IP only.
- Login failures are always the same 401 response regardless of email/username existence.
- Register 409 for taken email/username (registration inherently reveals it).
- Refresh rotation in a transaction; a revoked/expired/unknown refresh token is 401.
- Login and logout both bump `token_version`; refresh issues an access token with the current version.
- Rate limiters run **before** argon2 verification to avoid CPU exhaustion.
- Database unavailability becomes 503, not a crash; the server still boots and `/api/health` still answers.
- JWT secrets shorter than 32 chars: warn in dev, reject in production. The human's existing `.env` uses `change-me`; either update it or let dev warn.

### One-session kick

- Kick saves the authoritative position before closing the socket; `dirty` is cleared so the following `onLeave` does not overwrite a newer session.
- The registry is keyed by account and character; `onLeave` only unregisters if its `sessionId` matches.
- Login from a second browser: old room gets `sessionKicked` + close 4100; old access token fails `tv` check on any rejoin.
- Duplicate join with the same token: the newer join wins; the older tab returns to character select (tokens stay valid).
- Cross-process limitation: the registry is in-process. Single-process deployment is the Phase-2 expectation; record it.

### Character transactions

- 4-slot limit: `SELECT … FOR UPDATE` on the account row, count, insert inside one transaction.
- Name uniqueness: DB expression unique index, case-insensitive; map `23505` to 409 `name_taken`.
- Deleting an online character: kick/save first, then delete; delete is hard today (items arrive in Phase 4, cascade then).
- Character creation stats come from `classes.json`; HP/MP from `formulas.ts`; default position is the village spawn from `mapRegistry`.
- Never trust client-supplied name/kingdom/level/position.

### Join, map and warp

- Static `onAuth` returns the full safe identity; `onJoin` only uses it.
- `options.map` must equal the character's saved map; a stale client gets a clean auth failure, then refetches characters and retries once.
- Warp reservations pass an `AuthContext`; the target room accepts the server-issued warp token without a JWT, so an expired access token never breaks a map change.
- Save the destination position before reserving; on failure restore the room state and re-save the source position.
- Warp tokens are single-use, 30 s, bound to account + character + map; wrong-map checks do not burn a token (Phase-1 behaviour preserved).
- The arrival cooldown, "client did not leave" timeout, and token pruning from Phase 1 remain.

### Persistence lifecycle

- Join: load, validate position with `nearestWalkable`, mark dirty if corrected.
- Tick: mark dirty only when the authoritative position changes.
- 60 s autosave: only dirty, non-warping players; `Promise.allSettled`; errors logged.
- Leave: save if dirty; always after a kick that already saved (so skipped).
- Warp: explicit save, as above.
- Server crash: at most 60 s of movement lost.

### Client state machine

- Screens: boot/checking → auth (login/register) → character select → connecting → world.
- On join failure: refresh token once, refetch characters (map may have changed), retry once, then surface the error.
- On kick: message + close code; login-replacement clears tokens, duplicate-join keeps them and returns to character select.
- Own sprite is hidden until the first authoritative patch; remote sprites use the appearance from state.
- Map restart when the selected character's map differs from the currently rendered map; guard against restart loops.
- Never unhandled-reject on connect/logout; all API calls have `.catch`/try-catch.

---

## 4. Tests

| File                                             | Covers                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/test/characterRules.test.ts`    | Name rules, class/appearance enums, map labels                                                                                                                              |
| `packages/shared/test/auth.test.ts`              | Register/login/refresh DTO validation                                                                                                                                       |
| `packages/shared/test/formulas.test.ts`          | `maxHp`/`maxMp` reference values                                                                                                                                            |
| `packages/data/test/classes.test.ts`             | JSON validity, 4 classes, stats/doctrines match §4.2, ids match shared                                                                                                      |
| `apps/server/test/auth/passwords.test.ts`        | Argon2id hash/verify, wrong password, salt uniqueness, length limits                                                                                                        |
| `apps/server/test/auth/tokens.test.ts`           | Access/refresh sign/verify, expiry, wrong type/secret/issuer, malformed claims                                                                                              |
| `apps/server/test/http/rateLimit.test.ts`        | Window, per-key isolation, reset, over-limit                                                                                                                                |
| `apps/server/test/db/persistence.test.ts`        | Real DB: register/login/refresh/logout, duplicates, ban, token version, sessions, character CRUD, 4-slot race, case-insensitive names, ownership, save/load, spawn snapping |
| `apps/server/test/api/routes.test.ts`            | HTTP status codes/shapes with fake services, auth required, no hash leakage, kick on login, 429, 503                                                                        |
| `apps/server/test/rooms/joinAuth.test.ts`        | JWT path, warp-token path, map/ownership/version/ban checks                                                                                                                 |
| `apps/server/test/rooms/sessionRegistry.test.ts` | register/unregister, save-before-kick, duplicate-session handling                                                                                                           |
| `apps/server/test/rooms/warpTokens.test.ts`      | Extended token binding, single use, TTL, wrong map/character                                                                                                                |
| `apps/server/test/rooms/rooms.test.ts`           | All Phase-1 movement/chat/interest/warp tests with fake auth, plus auth-required join, saved spawn, appearance in state, save on leave, autosave, kick, map mismatch        |
| `apps/client/test/api.test.ts`                   | Refresh-and-retry, refresh failure, error parsing                                                                                                                           |
| `apps/client/test/characterKeys.test.ts`         | Texture key determinism/bounds                                                                                                                                              |
| `scripts/verify-phase2-e2e.mjs`                  | Full acceptance flow against the real stack                                                                                                                                 |

Existing tests updated: `rooms.test.ts` joins; `verify-phase1-e2e.mjs`; `smoke-server.mjs`. `packages/data/test/maps.test.ts` is untouched.

---

## 5. Acceptance verification

| Acceptance (GAME_DESIGN §12)               | Automated verification                                                                                      | Manual verification                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Register                                   | `POST /api/auth/register` tests + e2e; duplicate email/username tests                                       | Fill the Register tab; account is created and lands on character select       |
| Create a character                         | Character service tests + e2e create; 4-slot/name/class/appearance validation                               | Create each class; check preview, name rules, 5th slot disabled               |
| Walk                                       | Existing movement/prediction tests + e2e input/ack                                                          | WASD/click move; remote tab sees smooth movement                              |
| Log out                                    | Logout route/service tests + e2e leave                                                                      | Click Log out; returns to login; DB `characters.x/y/map` updated              |
| Log in                                     | Login tests + e2e                                                                                           | Log back in; character list appears                                           |
| Character is where it was                  | e2e compares the rejoin state to the saved position/map                                                     | Leave on the fields, log in, spawn at the same spot/map                       |
| Second login kicks the first session       | e2e: second login, first room receives `sessionKicked`/4100; old token rejoin fails; registry/version tests | Two browsers: second login shows "signed in elsewhere" in the first           |
| LPC-style layered placeholder appearance   | State appearance fields + texture key tests                                                                 | Preview and in-world sprite change with gender/class/hair; remote tab matches |
| React login/character select styled per §2 | — (human)                                                                                                   | Dark lacquer/jade/gold panels, consistent with the existing UI                |
| `pnpm dev` / build / test / typecheck      | All commands run at the phase gate                                                                          | `pnpm dev` starts DB, server, client, admin                                   |
| Migrations                                 | `pnpm db:migrate` + boot migration                                                                          | Fresh DB gets tables automatically                                            |

Phase-gate commands:

```
pnpm install
pnpm db:migrate          # with a reachable test/dev database
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm dev
node scripts/verify-phase2-e2e.mjs
```

---

## 6. Risks and mitigations

1. **Colyseus static vs instance `onAuth`** — use `static onAuth`; never an instance one. Passing no `AuthContext` to `matchMaker.joinOrCreate` after this change will crash; update `reserveSeat` in the same task.
2. **Argon2 native install under pnpm 12** — prebuilt NAPI package; if pnpm blocks its install script, add an `allowBuilds` entry. Verify `hash`/`verify` before building on it.
3. **Database not reachable (Pi / Docker)** — acceptance and migrations need it. Provide the local `docker compose up -d` path, keep `/api/health` alive when it is down, and make auth return 503 with a clear UI message.
4. **Migration path in the CJS bundle** — `drizzle/` is not bundled; run `pnpm start` from `apps/server` and document it. `@node-rs/argon2` must be external in esbuild.
5. **Access token expiry during long sessions / warps** — server-issued warp tokens; initial joins refresh-and-retry once.
6. **Kick/save race and position loss** — save before kick, dirty flags, registry `sessionId` matching.
7. **Warp save/reservation failure** — save destination before reserve; on failure restore and re-save source; skip autosave for warping players.
8. **Case-insensitive name race** — rely on the DB expression index and map `23505`.
9. **Character slot race** — `FOR UPDATE` account lock; test concurrent creates.
10. **Parallel DB tests** — one DB-backed test file + `describe.sequential`, `TEST_DATABASE_URL` with a `_test` guard, CI Postgres service.
11. **Removing guest join breaks existing tests/scripts** — update `rooms.test.ts`, `verify-phase1-e2e.mjs`, and `smoke-server.mjs` in the same phase.
12. **Client routing regressions** — hide the own sprite until connected, guard the map-restart loop, handle kicked/logged-out transitions explicitly.
13. **JWT in URL query** — accepted for now; short-lived access tokens; production proxy config is Phase 10.
14. **ASCII name rule** — deliberate simplification; record it.
15. **Zod/Drizzle API drift** — re-check installed typings in task 1 (table extra config form, expression indexes, `.for("update")`, `z.email`).

### Decisions to add to `DECISIONS.md`

- D21: static `onAuth` at matchmaking; `client.auth` carries the identity; warp tokens instead of JWT re-verification.
- D22: access JWT + rotating refresh sessions (hashed), `token_version`, in-process kick registry, close code 4100.
- D23: Drizzle schema/keys; app-generated UUIDs; expression unique indexes; 4-slot `FOR UPDATE` transaction.
- D24: persistence save points (leave/warp/60 s dirty autosave) and spawn sanitisation.
- D25: character identity/appearance in state; layered procedural placeholder keyed by appearance.
- D26: migrations on boot plus explicit `db:migrate`; server survives a down database.
- D27: test DB strategy and CI service.
- D28: registration fields and validation rules (ASCII names, 8–128 passwords, account kingdom immutable).

_End of Phase 2 plan._
