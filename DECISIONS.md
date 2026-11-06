# Jade Throne — Decisions log

One short paragraph per non-obvious technical decision. Entries are appended as they are made during tasks. This file is seeded with the pre-researched foundation decisions (1–5); 6+ are added during implementation.

## D1 — Stay on the Colyseus 0.17 line

Colyseus 0.18 is the current npm latest, but `AGENTS.md` pins 0.17, which is still maintained under the `legacy-0.17` dist-tag (`colyseus@0.17.11`, `@colyseus/core@0.17.56`, `@colyseus/schema@4.0.x`, `@colyseus/sdk@0.17.x`). We use the 0.17-recommended `app.config.ts` structure (`defineServer` / `defineRoom`). To be confirmed during task 6 against the installed typings: the exact `defineServer`/listen signature of 0.17.11 — resolved in task 6: we import from `@colyseus/core` instead of the `colyseus` meta bundle, see D6. Also belongs to this decision: `@colyseus/schema@4` uses legacy decorators, so the server tsconfig must set `experimentalDecorators: true` and `useDefineForClassFields: false`.

## D2 — TypeScript pinned to 5.9.3

TypeScript 6.x/7.x exist (7.0.2 is the current npm `latest`), but `AGENTS.md` specifies TypeScript 5.x strict mode, and typescript-eslint 8.72.1 accepts `>=4.8.4 <6.1.0`. We stay on the last 5.x release (5.9.3) and upgrade deliberately later, never silently.

## D3 — Versions single-sourced via pnpm catalogs + build-script allowlist

Every dependency version is pinned once in the `catalog:` block of `pnpm-workspace.yaml`; each `package.json` references versions as `"catalog:"`, so no version can drift between apps. The `packageManager` field pins `pnpm@12.16.1`. pnpm 12 hard-blocks dependency build scripts and fails installation (`strictDepBuilds`) until each package is explicitly allowed — and the old `onlyBuiltDependencies` setting was removed in favor of an `allowBuilds` map in `pnpm-workspace.yaml`. esbuild (transitive dependency of tsx, needed for our server build) is explicitly allowed; the optional native accelerator `msgpackr-extract` is explicitly denied — msgpackr falls back to pure JS, which avoids requiring a node-gyp/MSVC toolchain on dev machines and in CI. Adjustment made during implementation: packages that contain tests (starting with `packages/shared`) also declare `vitest` in their own `devDependencies` so `tsc --noEmit` can resolve the import inside test files — pnpm does not hoist root dependencies into workspace packages.

## D4 — Shared and data packages are consumed as TypeScript source

`@jadethrone/shared` has no build step: `exports`/`types` point at `./src/index.ts` (confirmed against the installed files during task 6 — see D6 for the package-resolution angle). Vite compiles it in the apps, tsx runs it in the server dev loop, and esbuild bundles it into the server production build. `@jadethrone/data` is pure JSON/asset storage so far; when it gains its first TypeScript entrypoint (validation scripts, Phase 3+), it gets the same treatment. One source of truth, no per-package emit/watch orchestration.

## D5 — Express 5.3.0 for the REST API

The current express major is 5, and `@colyseus/monitor@0.17` accepts `>=4.16.0`, so nothing in the 0.17 toolchain forces express 4. We do not mount the monitor until Phase 5; if compatibility problems appear there, dropping to express 4.22.3 is the recorded fallback.

## D6 — The server uses @colyseus/core directly, not the `colyseus` meta bundle

pnpm 12's `blockExoticSubdeps` guard (a supply-chain protection kept enabled) failed installation of the `colyseus` meta bundle because its transitive tree resolves `uWebSockets.js` from a git repository. Reading the installed 0.17.56 typings confirmed the meta was not needed anyway: `defineServer`, `defineRoom`, `Server`, `Room` are all exported from `@colyseus/core`, the default WebSocket transport is auto-detected, and `.d.ts` files resolve cleanly through the package `exports`. We therefore depend on `@colyseus/core@0.17.56` + `@colyseus/schema@0.17-schema-4.0.31` + `@colyseus/ws-transport@0.17.13` directly and import from `@colyseus/core`. This is also a leaner tree: the meta drags in `@colyseus/playground`, redis packages and `@pm2/io` that we do not use. Agent-typing note: `defineServer` in 0.17 returns a non-Server stub only when Colyseus's opt-in devMode is enabled (`setDevMode`/`.devmode.json`) — never in our flow.

## D7 — Verification smoke script

Booting and killing a dev server process reliably on Windows requires killing the whole process tree (`taskkill /T`), which is awkward to script inline. `scripts/smoke-server.mjs` boots the server via tsx, polls `GET /api/health` until it answers, kills the process tree, and exits 0/1 — used to verify every server task headlessly and at the phase-end review.

## D8 — Server production bundle is CJS

`esbuild --format=esm` broke at runtime: Colyseus's CJS dependencies do `require()` on Node builtins (`tty` via `debug`), which esbuild's ESM output does not allow without a `createRequire` banner. The bundle therefore now emits `dist/index.cjs` in CJS format. Consequence: no top-level await in the entrypoint — `server.listen(...)` is chained with `.then()/.catch()` instead.

## D9 — The /api/health DB probe needs a hard deadline and singleflight

Two Windows-specific findings from verifying the endpoint against an unreachable `raspberrypi.local`: (1) pg's `connectionTimeoutMillis` (1.5 s) does not reliably cover a hanging DNS/LLMNR lookup — a dead-cached `.local` name can stall `Client.connect()` well beyond it — so the handler races the DB ping against a 2 s deadline (`db: "unavailable"` on timeout; late results are ignored and the client closes itself). (2) Health endpoints get polled aggressively once monitoring exists, so in-flight pings are singleflighted — one hung ping must not pile up a pg client per request. Also note for test harnesses: the probe client must allow more than the server's own 2 s health deadline, or worst-case responses get aborted client-side.

## D10 — Server dev: `node --watch --import tsx` instead of `tsx watch`

`tsx watch` (4.23.15) hangs at boot under `concurrently` 10's default (non-prefixed, non-raw) stdio wrapping — the process never evaluates the entrypoint and prints nothing after its command line; standalone and under `concurrently --raw` it boots fine, so the trigger is the pipe wrapping. The plan's documented fallback (`node --env-file-if-exists --import tsx --watch`) has no supervisor of its own and mounts the tsx loader inside plain `node --watch` — which boots reliably under concurrently with color prefixes intact and hot-reloads on edit. Adopted for the server `dev` script.

## D11 — Map files are Tiled JSON with a `.json` extension

Maps are Tiled JSON (same format the spec calls `.tmj`) but named `*.json` so Vitest/Vite/tsx/esbuild all import them as typed JSON modules without extra loaders or runtime path resolution. Tiled opens `.json` maps normally. `resolveJsonModule` is enabled in `tsconfig.base.json`; both client and server parse the exact same bytes through `parseTiledMap`, which is what guarantees identical collision grids.

## D12 — One room type per map, and map assets are memoized shared JSON

`map_ember_village` and `map_ember_fields` are separate registrations of the same `MapRoom` class; `roomName` is the map id (clients pick a map by joining its named room, which is intended for guest play; spawn points are server-issued). Server and client import the same generated JSON and build the collision grid with the same shared parser; `apps/server/src/maps/mapRegistry.ts` memoizes parsed assets per map. `createGameServer()` builds the server without listening so `@colyseus/testing` can boot it for room tests.

## D13 — Movement input: one tick per intent, dropped-not-kicked validation

Each validated `input` intent is stepped for exactly one 50 ms tick, and the server applies **at most one intent per tick**: a burst of queued inputs is spread over subsequent ticks, so no client can exceed 200 px/s no matter how it batches messages. Click-to-move sends a `path` intent each tick; the server recomputes A* from its current position for each intent. That costs one A* per auto-walking player per tick — acceptable at Phase-1 scale — but it is what makes reconciliation exact: replaying from any acknowledged position recomputes the identical path as long as the target and grid match. To bound hostile clients without breaking that parity, a repeated unreachable goal is cached for 1 s and rapid retargets are limited to one per 100 ms (the client still recomputes every tick, so a spammer only desynchronises itself). Idle clients send a single `none` and then nothing. If input packets are lost, the server keeps the last direction for up to `SERVER_TICK_GRACE_TICKS` (3) ticks so a dropped packet cannot stop the character mid-step; an explicit `none` clears the grace and stops immediately. Malformed payloads fail `safeParse` and are logged + dropped inside the handler instead of using Colyseus's schema-validated `onMessage` overload, because that overload disconnects the client on the first invalid message. Final path waypoints snap to the exact target when it is within one step and walkable (and `findPath` returns a short hop when start and goal share a tile), so clicks land where the player clicked.

## D14 — Local chat is direct, range-filtered sends (not room broadcasts)

Chat recipients are selected by the shared `chatRecipients` helper (900 px around the sender, sender included for the echo/bubble) and delivered with `client.send("chatMsg")` to just those clients; a per-sender 1 s cooldown is enforced server-side. This keeps chat consistent with interest management without coupling it to state patches, and Phase 8 can add shout/whisper/scramble on top. `SIMULATE_LATENCY_MS` calls `server.simulateLatency()` in both directions for the acceptance test (F3 ping therefore reads roughly double the configured value).

## D15 — Interest management: tagged collection + per-client StateView at 4 Hz

The `players` map is view-tagged and each client owns a `StateView`; `updateInterest()` adds a player inside 850 px and removes them beyond 900 px, always keeping the own player visible. The pass runs at 4 Hz (`clock.setInterval(..., 250)`) plus immediately on join, so joins feel instant without paying the O(players²) cost every tick. In Phase 3 this becomes a spatial hash if the population grows.

## D16 — Warp = server seat reservation + single-use spawn token

Walking onto a `warp` object makes the room remove the player, issue a single-use 30 s warp token (`crypto.randomUUID`, in-memory per process), reserve a seat with `matchMaker.joinOrCreate(targetMap, { name, kingdom, warpToken })`, and send the returned `ISeatReservation` to the client as `warp`; the client leaves, consumes it, and fades into the new map. The target room only accepts a spawn position from that token — join options no longer carry `x/y`, so a client cannot teleport to an arbitrary walkable point. The token also arms a 2 s arrival cooldown so the destination spawn cannot bounce the player back. A failed reservation restores the player only if the client is still connected; a client that leaves mid-warp is never re-inserted as a ghost.

## D17 — Remote players: receipt-time samples rendered 100 ms behind

Each state patch pushes one `(x, y)` sample timestamped with the local Phaser clock; the scene renders `now − 100 ms` by binary-searching and lerping between bracketing samples, clamping at both ends (no extrapolation). A >200 px jump clears the buffer and snaps the sprite. Several patches can arrive in one render frame, so samples sharing a receipt timestamp replace each other (latest authoritative position wins) instead of being dropped as out-of-order. Visible-player sync iterates the StateView-filtered `players` map on every patch instead of using `onAdd`/`onRemove`: with at most a few hundred entities this is simpler, handles interest add/remove and leave in one path, and avoids the callback API's collection-availability edge cases.

## D18 — Warp failure cooldown, token pruning and ghost disconnect

A failed seat reservation restores the player **and** sets the normal 2 s warp cooldown, otherwise a persistent matchmaker outage would retry 20 times per second and leak a token per attempt. Expired warp tokens are pruned on every issue (not only when consumed), a token presented to the wrong map is rejected without being burned, and a client that receives a `warp` message but never leaves is disconnected after 2 s so it cannot hold a room seat and a target-room reservation indefinitely.

## D19 — Tall decor is rendered as y-sorted images, not a tile layer

Ground and `above` stay as tilemap layers (depth 0 and 100000), but every non-empty `decor` tile becomes an individual image anchored at the bottom of its cell with `depth = (row + 1) * TILE_SIZE`. This makes trees and fences sort against the player by their base row — standing north of a tree draws behind it, south draws in front — which a single tile layer cannot express. Tileset textures get one Phaser frame per 32 px column in `Preload` so the images can address the same tiles the tilemap uses.

## D20 — Local prediction uses render-only interpolation

The local simulation remains fixed at 20 Hz, but `visualPosition` lerps the previous and latest predicted positions by the fixed-step accumulator fraction. This adds at most one tick of presentation delay and deliberately avoids extrapolation, which could overshoot collision or path endpoints. Reconciliation replays the penultimate as well as the latest position so the active interpolation segment survives a patch; small corrections remain continuous offsets from that segment, while large snaps reset both positions. Interpolation never feeds back into input history, shared movement, or the authoritative simulation.

## D21 — Phase-2 schema is hand-owned Drizzle SQL, applied by boot and CLI

`apps/server/drizzle/` holds the committed migration SQL generated from `src/db/schema.ts`; `drizzle-kit` only generates. `pnpm db:migrate` applies it, and the server also runs the same migrator in the background after `listen()` so a fresh database self-heals without blocking the HTTP health endpoint when the database is down. IDs are application-generated UUIDs (no DB extension), and case-insensitive uniqueness for email/username/character name is enforced with `lower(...)` expression indexes rather than application pre-checks, because registration races are otherwise possible. `characters` uses `class_id`/`map_id` column names (the spec's `class`/`map` are reserved-ish in SQL and ambiguous in TypeScript).

## D22 — Class data and character-creation rules live in data + shared, not components

`packages/data/classes.json` is the single source for class names, starting stats, doctrine pairs, HP/MP bases and placeholder outfit colours; `@jadethrone/data/classes` validates it with Zod at import so a malformed file fails at boot instead of creating half-broken characters. Character names are ASCII letters/numbers 3–16 (the spec says "letters/numbers"; Unicode names would need a normalization/uniqueness policy we are not ready for). Base HP/MP values are provisional Phase-2 choices (`warrior 120/20`, `assassin 90/30`, `hexblade 100/40`, `mystic 80/50`) so level-1 characters persist sensible values; Phase 3 tunes them with the combat formulas. Only the two HP/MP formulas are in `shared/src/formulas.ts` for now.

## D23 — Phase-2 transactions and refresh/replay policy

Every account/session transaction locks the `accounts` row first, then sessions, then characters. Login must lock the account row: revoking all live sessions and inserting the new one is only atomic with respect to another login if both run under that lock, otherwise two concurrent logins can each insert after the other's revoke and leave two live sessions. Register inserts the account and its first session in one transaction but does not bump `token_version` (there is nothing older to invalidate). Refresh rotates inside one transaction with the session row locked; reusing a rotated refresh token is rejected with 401 and a security log, but does **not** revoke the live session (a stale tab must not be able to log the active session out). Logout is idempotent: a second logout of an already-revoked row succeeds without bumping `token_version` again. Services take an injected `db` and secrets rather than calling `getDb()`, so tests can point at `TEST_DATABASE_URL`.

## D24 — Authorization happens at matchmaking via a static `onAuth`; warps use bound tokens

Colyseus 0.17 calls a room's **static** `onAuth(token, options, context)` from the matchmaking HTTP path and stores its return value as the reservation's auth data, which later lands on `client.auth` before `onJoin`. We use that: token/character/map validation fails before a seat exists, and warp reservations carry the identity. Because access tokens expire after an hour but a session can warp much later, the target reservation is authenticated by the server-issued warp token instead (single-use, 30 s, bound to account + character + map); the target room still consumes the token and checks ownership. Once MapRoom defines a static `onAuth`, every `matchMaker.joinOrCreate` call must pass an `AuthContext` argument or `callOnAuth` dereferences undefined — the warp path passes an empty context.

## D25 — One live session is enforced by a token version plus an in-process registry

Login/logout bump `accounts.token_version`, so a stale access token can never rejoin even if its JWT is still valid. To kick the currently connected client immediately (the acceptance criterion), a single-process `SessionRegistry` maps account/character → live Colyseus client. Login commits its token change first, then awaits `kickAccount`, which saves the old session's authoritative position, sends `sessionKicked` and closes with application code 4100 (Colyseus owns 4000–4010). A duplicate join with the same token replaces the older session the same way; `onLeave` only unregisters when its session id still matches, so a warp or a replacement cannot remove the newer session. A pre-kick save clears the room's dirty flag, so the following `onLeave` cannot overwrite the newer session. Horizontal scaling is a Phase-10 concern.

## D26 — Deleting an online character is blocked, not kicked

`deleteCharacter` takes an injected `isOnline(characterId)` predicate; the route wires it to the in-process session registry and returns 409 `character_online`. This is a deliberate simplification of the phase plan's "kick, then delete": a DB service must not await room internals, and the kick-then-delete path has a save-after-delete race. The accepted residual window is a join whose `onAuth` read happens just before the delete commits; the ghost cannot save (0-row update is a silent no-op) and cannot rejoin. Phase 4's item cascades will revisit deletion.

## D27 — DB tests use a dedicated `_test` database and self-applied migrations

`apps/server/test/db/persistence.test.ts` runs only when `TEST_DATABASE_URL` is set; the harness refuses any URL without "test" in it (so a stray env var can never touch dev data), applies the committed migrations itself, and uses randomized emails/usernames/character names so repeated runs are order-independent instead of relying on truncation. Locally the test database is `jade_throne_test` on the Pi; CI will point the same variable at its Postgres service. Pure logic (error mapping, character derivation, passwords, tokens) keeps running without a database.

## D28 — REST middleware is scoped under `/api`, with per-IP fixed-window limits

The Express app is shared with Colyseus's matchmaking/WebSocket routes, so JSON body parsing, the `/api` 404 and the error handler are mounted only where they belong; a catch-all would swallow matchmaking. Register/login/refresh use in-memory fixed-window limits (5/10/30 per 15 minutes per IP) **before** argon2 work, so a flood cannot burn CPU. `req.ip` is the proxy's address in dev; production needs `trust proxy` plus proxy hygiene (Phase 10). Services still return the single `ServiceError` taxonomy; the error middleware serialises it and logs only unexpected failures.

## D29 — `jsonwebtoken` is imported through its default export

`jsonwebtoken` is CommonJS with named exports assigned dynamically, so `import { TokenExpiredError } from "jsonwebtoken"` passes TypeScript and Vitest's Vite interop but crashes the real `tsx`/node ESM loader at boot. We import the default object and classify expiry by `error.name === "TokenExpiredError"`. This is also why every server task is smoke-tested through the tsx entrypoint, not only through Vitest.

## D30 — Rooms trust only `client.auth`; room tests inject fakes for auth and saves

`MapRoom.onJoin` takes no join options at all: names, kingdom, class, appearance, level and spawn come from the object returned by the static authenticator (which travelled with the seat reservation). Saved positions are accepted only when walkable on this room's grid; otherwise the map spawn is used and the correction is marked dirty. Player state now carries `characterId`, `classId`, `gender`, `hairStyle`, `hairColor` and `level` for remotes. Room tests inject a fake `JoinAuthenticator` and fake `savePosition`/`savePositions` through `createGameServer`, so the 34 movement/chat/interest/warp tests run without a database while the real auth/HTTP paths are covered by dedicated DB tests.

## D31 — Persistence save points and warp ordering

The authoritative position is saved on leave (if dirty), immediately before a warp reservation, and every 60 s for dirty non-warping players (one `UPDATE … FROM (VALUES …)` for the whole room). A successful save clears `dirty`; the kick registry calls the room's save first, so the following `onLeave` cannot overwrite a newer session. A warp saves the destination **before** reserving a target seat (the target's `onAuth` loads that row), then reserves with the bound warp token; on reservation failure the player is restored, the source position is written back best-effort, and the normal 2 s cooldown applies. Saving the destination and then restoring is deliberate: it lets the target authenticate from the database rather than trusting the client. The intentional warp also unregisters the old session before the target join, so the move is not mistaken for a duplicate-session kick.

## D32 — Client session, screens and procedural layered appearance

Tokens live in `localStorage` (no cookies, so no CSRF surface); the access token is attached with `sdk.auth.token`. One shared refresh promise handles 401s, so concurrent requests rotate the refresh token once. Boot calls `restore()` (rotate + `/me` data); a failed restore clears tokens and shows login. Screens are derived from `authPhase` + `connectionPhase` rather than a router: checking → login/register → character select → world. A join failure retries once after `/me` (expired token or a character moved maps in another tab). Login-replacement kicks clear tokens; duplicate-join kicks keep them and return to character select. The world hides the own sprite until the first authoritative patch, switches maps by restarting the scene when `ui.mapId` changes, and renders characters from a procedural layered canvas texture keyed by `class/gender/hairStyle/hairColor` (same painter as the select-screen preview), so art can later replace it under the same key.

## D33 — Combat formulas follow the spec verbatim, XP stores level progress, rolls use an injected RNG

All Phase-3 combat math lives in `packages/shared/src/formulas.ts` and mirrors `GAME_DESIGN.md` §4.4 exactly: `xpToNextLevel = floor(120*L^2.25)`, physical attack = weapon + class stat contribution + `level*2` (weapon 0 until Phase 4), damage = `max(1, round(0.9–1.1 roll * atk - def*0.7))`, hit chance and crit chance as written, death loss 2% of the current level requirement. `characters.xp` stores progress *inside* the current level rather than lifetime XP: it matches “2% of current level XP”, keeps the existing `level` column authoritative, and needs no migration; an over-full value on load is levelled up in memory and marked dirty. Every roll takes a `RandomSource` (new in `rng.ts`) instead of calling `Math.random`: the live server installs a crypto-backed implementation and tests/balance scripts install `seededRandomSource(seed)`, which wraps the existing `mulberry32`.

## D34 — Combat FX travel as one event per swing; auto-walk switches the client out of prediction

HP, MP, positions and monster HP stay in schema patches. Transient facts that state cannot express travel as direct messages: one `combat` message per swing carrying every hit (miss/crit/damage/position), `monsterDied`, `levelUp`, owner-only `death` and `selfStats`, and `autoWalk`. This avoids per-tick damage spam and keeps the payload ordering explicit with a server `eventSeq`. The arc test is a trig-free dot-product check (`dot >= 0` for “in front”, `4*dot² >= |v|²` for the 120° cone) so client and server agree exactly. Click-to-attack is server-driven: the server sends `autoWalk {active:true}` and the client stops predicting, rendering its own body from patches; on cancel/arrival it sends `active:false` and the client recreates the predictor at the authoritative position. Replaying stale inputs against monster positions the client did not know when it sent them would otherwise rubber-band the character.

## D35 — Monster, spawn-group and class-attack data are files, not constants

`packages/data/monsters.json` holds all ten starter monsters; `packages/data/spawnGroups.json` holds the group composition and respawn windows keyed by the `spawnGroupId` already present in the Tiled `mob_zone` objects. Both are Zod-validated at import, cross-reference monster ids, and keep `dropTableId` nullable until Phase 4 (gold/drop fields are present but inert). Basic-attack range, cooldown and target cap live in a new `attack` block in `classes.json` (Warrior 64 px/900 ms/8 targets, Assassin 56 px/650 ms/6), which keeps the class schema the single source of truth for the client HUD and server validation.

## D36 — `mob_zone` is parsed in shared; the fields map gains a dedicated boss clearing

`extractMapObjects` now returns typed `MobZone` rectangles with a required `spawnGroupId` string, and `MapAssets` carries them to the server. The fields generator gained a fifth clearing at (138,129) and a fourth `mob_zone` (`field_boss`, 12×10 tiles) so the Wolf King has its own leash area instead of overlapping the bandit camp. Generation stays deterministic; the committed fields map changes only around the new clearing.

## D37 — Progression is derived once on join; public HP/MP and private XP/stats are split

`PlayerRuntime.progression` is the authoritative HP/MP/XP/level/stats bundle, derived by `progressionFromCharacter` from the persisted character using the same class data and formulas as creation. It clamps HP/MP to the derived maxima, revives `hp <= 0` rows at full HP, and levels up over-full XP rows in memory (granting their stat points) while marking the runtime dirty. Only HP/MP are mirrored into `PlayerState` because target/party frames need them publicly; XP, stat points and raw stats travel to the owner in `selfStats`. The server RNG seam is `ServerServices.createRandomSource`: production installs `createCryptoRandomSource` (`node:crypto.randomInt`), tests inject `seededRandomSource`, and `combatTuning` carries short respawn timings for room tests.

## D38 — Monster AI leashes before sleeping, is cheap when asleep, and owns its HP server-side

`stepMonsterAi` is a pure-ish function over `MonsterRuntime` + `MonsterState`; the room supplies a per-tick player snapshot (positions from `PlayerRuntime.mover`, not float32 state), an injected clock, a seeded RNG and a `takeAstar()` budget. Leash is evaluated before the sleep gate, so a monster whose target fled cannot freeze in `chase`; returning monsters never sleep, are invulnerable, ignore damage aggro, and heal to full on arrival. Sleeping monsters consume no RNG, no A* and no movement. Chasing repaths at most every 500 ms and only when the target changes tile or the stored path is exhausted; three consecutive empty paths send the monster home, while budget-denied repaths do not count as failures. Targets are sticky while valid and ties break on the lower session id, which makes the AI order-independent in tests. `MonsterRuntime.hp` is the authoritative HP (`MonsterState.hp` is only the client mirror); Phase 3 has no monster out-of-combat regen beyond the return-home heal.

## D39 — Spawn groups own deterministic placement, pack aggro and respawn timing

`SpawnManager` is created once per room from `MapAssets.mobZones` and `spawnGroups.json`. Each group gets its own seeded `RandomSource` (`mapId:groupId`, fed by the room's RNG factory), so a fixed seed reproduces the same pack layout. `placeGroup` puts the leader at the zone centre (snapped with `nearestWalkable`), members on a 48–72 px ring, then random in-zone fallbacks; every candidate must be walkable, inside the zone margin, at least 24 px from other monsters and 40 px from players. Monster ids encode zone/generation/index (`m0_g1_3`) so a respawn never reuses a schema key. A group respawns only when its last member dies, 30–60 s later (boss 20 min), with one roll per wipe; a fully blocked zone retries in 5 s instead of waiting the full window. Damaging any member aggros all living, non-returning members.

## D40 — The room owns one spawn manager, one monster runtime map, and a single AI stage

`MapRoom.onCreate` builds the spawn manager from `MapAssets.mobZones` and spawns one generation before any client joins; group seeds come from `roomId + groupId`, so each room is stable while different rooms differ. The tick is now `input/movement → ai → spawns → warps` (combat and regen slots reserved), with one player snapshot per tick whose positions come from `PlayerRuntime.mover` and one `MAX_ASTAR_PER_TICK` shared budget across all monsters. `updateInterest` applies the same 850/900 px hysteresis to the view-tagged `monsters` collection, so StateView delivers monster spawns, despawns and chasing movement without a second visibility system. A player who leaves or warps is removed from every monster’s target immediately; the AI otherwise retargets or returns home on the next tick.

## D41 — Combat resolution is pure; the room owns event fan-out, aggro and deletion

`resolvePlayerSwing` in `rooms/combat.ts` only reads the room maps and mutates monster HP; it returns hits, kills and the damaged-monster list. `MapRoom` then sends one `combat` event per swing (whiffs included, empty `hits`) to every client within 900 px of the attacker, calls `aggroGroup` for every damaged monster **before** removing kills (otherwise a one-shot kill would delete the group lookup first), deletes the killed entities, broadcasts `monsterDied` with pre-captured position/type, and only then lets the next swing see the remaining HP. Attacks are queued in a single `pendingAttack` slot and resolved in the tick, so a burst collapses to one swing and the cooldown is checked against tick time. Arc candidates come from `MonsterRuntime.mover.pos`, excluding returning/dead monsters before target-cap selection; the RNG draw order is fixed as hit → damage → crit for seeded tests. `lastCombatAtMs` is set only when a swing actually deals damage, and a spawn respawn triggers an immediate `updateInterest()` rather than waiting for the 4 Hz pass.

## D44 — One `CharacterSave` payload covers position, vitals and progression; dead disconnects save the town

`PositionSave` remains the map-spawn return type, while `CharacterSave` adds `hp/mp/xp/level/stat*` and `statPoints`. `saveCharacterState` writes all columns in one `UPDATE`; `saveCharacterStates` does the same for a batch and clamps level/stats/HP/MP/points so a corrupt runtime cannot write nonsense. Every room save (leave, kick, autosave, warp destination, kill XP, stat allocation) builds the snapshot from `runtime.progression`, and `dirty` clears only when the position **and** every progression field still match the snapshot. Autosave skips dead players; leaving or being kicked while dead converts the save to the village spawn at full HP/MP, so relogin never lands on a death screen. `respawnInTown` sets full HP/MP before `beginWarp`, so the destination row carries them. The per-character save chain and snapshot ordering are unchanged; the bulk helper stays available for future room-wide flushes.

## D45 — Monsters reuse the remote-player interpolation buffer and level-gap nameplate colours

`MonsterRegistry` mirrors `RemoteRegistry`: every state patch pushes a receipt-timestamped `(x,y)` sample into a `SampleBuffer`, and the scene renders `now − 100 ms`, clamping at both ends. This keeps chasing monsters smooth without extrapolation and reuses the existing teleport threshold (a long correction snaps instead of sliding across the map). Monsters are removed from the registry as soon as the StateView drops them, with their sprite/shadow/nameplate/HP-bar destroyed in the same pass. Nameplates use the spec’s grey/white/yellow/red bands from the player’s level (+5 red, +1..+4 yellow, −4..0 white, −5 or lower grey), and placeholders come from `mob.<typeId>` manifest entries so real art can drop in under the same keys.

## D42 — Monster intents are captured before player actions; death, regen and respawn use absolute timestamps

`stepMonsters` records each `{monsterId, targetSessionId}` pair at AI time in a reused buffer, and the combat phase resolves them **after** player swings; re-validation inside `resolveMonsterAttack` means a monster that died or a player who died earlier in the same tick cannot land a hit. Players and monsters share the hit/damage/crit formulas and the same RNG order, with player defense derived from VIT. Death is idempotent: it clears pending input, movement, attack and monster targets, applies the 2% level-progress XP loss, sends the owner-only `death {respawnHereAtMs}`, and leaves the corpse in state (no broadcast). Regen is a 3 s accumulator per player (2%/0.5% max HP by combat timeout, 2% MP) that never overheals and resets for dead/warping players. “Restart here” validates the absolute `diedAtMs + delay` (shortened through `combatTuning` in tests) and sets 30% HP; “restart in town” reuses `beginWarp` to the village spawn and stays retryable if the reservation fails. The current save contract still persists only position, so town arrival HP/XP persistence is deliberately completed in Task 13.

## D43 — Kill XP, level-ups and stat points are owner-only `selfStats` snapshots

The killing blow awards monster XP with the level-gap multiplier; `applyXpGain` handles multiple levels, grants three stat points per level, and level-ups restore full HP/MP and recompute the class maxima. `selfStats` carries level, XP progress/next, HP/MP, stat points, raw stats and the derived attack/defense/crit values; it is sent after join, death, kills, level-ups and stat allocation, and the client can request a fresh snapshot with `requestStats` (needed because the join-time message can arrive before the SDK listener is bound). Stat allocation validates the point balance and the 90-point cap, recomputes max HP/MP, clamps current values, marks the character dirty and saves immediately. The level cap stops XP accumulation at 99.
