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

All Phase-3 combat math lives in `packages/shared/src/formulas.ts` and mirrors `GAME_DESIGN.md` §4.4 exactly: `xpToNextLevel = floor(120*L^2.25)`, physical attack = weapon + class stat contribution + `level*2` (weapon 0 until Phase 4), damage = `max(1, round(0.9–1.1 roll * atk - def*0.7))`, hit chance and crit chance as written, death loss 2% of the current level requirement. `characters.xp` stores progress _inside_ the current level rather than lifetime XP: it matches “2% of current level XP”, keeps the existing `level` column authoritative, and needs no migration; an over-full value on load is levelled up in memory and marked dirty. Every roll takes a `RandomSource` (new in `rng.ts`) instead of calling `Math.random`: the live server installs a crypto-backed implementation and tests/balance scripts install `seededRandomSource(seed)`, which wraps the existing `mulberry32`.

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

## D46 — Click-to-attack is server-driven; the client pauses prediction and re-seeds its input sequence

`setTarget` validates a live, non-returning monster within 1000 px, stores `targetMonsterId` on the player runtime and replies `autoWalk {active:true}`. While the target lives, `autoWalkStep` repaths at 250 ms, faces/attacks once inside the class range, gives up after 1.5 s without distance improvement or three empty paths, and sends `targetCleared` plus `autoWalk {active:false}`. Any movement input cancels it. On the client, `autoWalk` stops the predictor entirely (sending `none` would cancel the target server-side) and renders the own body from a `SampleBuffer` at 100 ms; when it ends, `LocalPredictor.resetAt` re-seeds the mover and sequence from the last authoritative `lastSeq`, so the next input is not discarded as stale. Space sends an optimistic swing plus the facing direction with a class-cooldown throttle; left-click picks a monster within 24 px and Tab cycles visible monsters as a client-only selection. `requestStats` is sent after every bind because the join-time `selfStats` can arrive before the SDK listener exists.

## D47 — The HUD reads `selfStats`; target/death state lives in the bridge store

The bottom HP/MP/XP HUD is driven by the owner-only `selfStats` snapshot for level/XP and by the public `PlayerState` vitals (pushed into the store on every patch) for HP/MP, so damage and regen update immediately without per-tick owner messages. The target frame is fed by `World.syncMonsters`, which copies the selected monster’s name/level/HP into the store on every patch; the store clears it when the StateView drops the monster or `monsterDied` arrives. The character window is a draggable `Window` that persists its position in `localStorage`, opens/closes on C/Escape (suppressed while chat is focused), and posts one `allocStat` per click. The death screen is a DOM overlay with `backdrop-filter: grayscale(1)` (no Phaser post-FX dependency) and a live countdown against `respawnHereAtMs`; both buttons send the same `respawn` message the server validates.

## D48 — Combat feedback is event-driven and pooled; audio is deferred to Phase 10

`combat` events drive a fixed pool of 24 damage-number texts (white normal, yellow crit, red for damage taken, grey MISS) that rise and fade; multiple hits in one swing are offset so they do not overlap. Crits shake the camera and freeze enemy sprite interpolation for 40 ms; every hit flashes the target white for 60 ms and gives monsters an 8 px outward visual knockback that decays over 90 ms (the authoritative position never moves). `monsterDied` spawns a short fade/sink corpse plus a puff, and `levelUp` shows a gold banner with a light pillar. HP bars appear above damaged monsters. There is no audio system until Phase 10, so hit/level-up sounds are intentionally omitted rather than faked.

## D42 — Monster intents are captured before player actions; death, regen and respawn use absolute timestamps

`stepMonsters` records each `{monsterId, targetSessionId}` pair at AI time in a reused buffer, and the combat phase resolves them **after** player swings; re-validation inside `resolveMonsterAttack` means a monster that died or a player who died earlier in the same tick cannot land a hit. Players and monsters share the hit/damage/crit formulas and the same RNG order, with player defense derived from VIT. Death is idempotent: it clears pending input, movement, attack and monster targets, applies the 2% level-progress XP loss, sends the owner-only `death {respawnHereAtMs}`, and leaves the corpse in state (no broadcast). Regen is a 3 s accumulator per player (2%/0.5% max HP by combat timeout, 2% MP) that never overheals and resets for dead/warping players. “Restart here” validates the absolute `diedAtMs + delay` (shortened through `combatTuning` in tests) and sets 30% HP; “restart in town” reuses `beginWarp` to the village spawn and stays retryable if the reservation fails. Task 13/D44 supersedes the original position-only save with the full `CharacterSave`, so town arrival HP/XP and dead disconnects now persist correctly.

## D43 — Kill XP, level-ups and stat points are owner-only `selfStats` snapshots

The killing blow awards monster XP with the level-gap multiplier; `applyXpGain` handles multiple levels, grants three stat points per level, and level-ups restore full HP/MP and recompute the class maxima. `selfStats` carries level, XP progress/next, HP/MP, stat points, raw stats and the derived attack/defense/crit values; it is sent after join, death, kills, level-ups and stat allocation, and the client can request a fresh snapshot with `requestStats` (needed because the join-time message can arrive before the SDK listener is bound). Stat allocation validates the point balance and the 90-point cap, recomputes max HP/MP, clamps current values, marks the character dirty and saves immediately. The level cap stops XP accumulation at 99.

## D49 — Item mutations use pure planners and one parking transaction

Every item change is a pure plan over the runtime's `InventoryState` (`{ changes, logs, gold }`) followed by one executor that locks `accounts → characters → items`, verifies each row's expected location/slot/quantity, then deletes and writes. Rows whose slot or location changes are first parked at unique negative slots, so swaps and equip-exchanges cannot trip the partial unique indexes in statement order. The room assigns the new state only after commit. `ServerServices` exposes one `ItemService` (`loadInventory`, `loadWarehouse`, `apply`) instead of one injected function per command; room tests use an in-memory fake that applies the same `ItemChange[]`.

## D50 — Loaded items are repaired, never silently deleted

`loadInventory` locks the character row, reads gold and item rows in one snapshot, and repairs overlaps, obsolete equipment slots, quantity corruption and unknown definitions before returning. Repairs are written with an `item_log` row (`action = "repair"`) so a hidden data problem leaves an audit trail. An unknown `definitionId` is treated as a size-1 material and kept; a misplaced equipment item moves to the first free inventory cell. New characters receive their starter weapon, potions and 500 gold inside the existing character-creation transaction, so a failed create leaves no orphan item or gold-log rows.

## D51 — Drops are DB rows; coins are ephemeral room state

Item drops are inserted into `items` as `location='ground'` before the room adds them to the view-tagged `groundItems` collection, so a pickup always has a row to claim with a conditional update. Gold piles are memory-only: they despawn with the room and are credited through `gold_log` on pickup. Drop ownership comes from a per-monster `damageBy` map (highest contributor, falling back to the killing blow); the owner has 30 s of exclusivity and items despawn after 2 min. Drop-table rolling is a shared pure function with a fixed draw order (gold, then table order) so seeded tests reproduce it. A room purges stale ground rows for its map at creation.

## D52 — Client inventory is a snapshot-driven DOM overlay; hotbar is local

The React overlay renders the owner-only `inventory` snapshot and never mutates it optimistically; a rejected drag simply waits for the next snapshot. Icons are generated as Phaser placeholders from `items.json` at Preload, so adding an item does not require a manifest edit. Equipment visual changes travel as four layer-key strings on `PlayerState`; own and remote textures are recomputed only when the key changes. The hotbar is a per-character `localStorage` map of item definition ids (not instance ids), so a consumed potion stack replaced by another still binds; the server only receives the resolved `useItem {instanceId}`. Ground drops are rendered from the view-filtered `groundItems` state with rarity beams and Alt labels; auto-loot is a client-side throttle that sends the same validated `pickup` intent as pressing Z.

## D53 — Inventory pages, drag semantics and deferred item actions

Both inventory pages are always open (the spec allowed “unlock at 20 or always open”); the server still enforces the 90-cell grid, so this is a UI-only choice. Dragging an item onto another item asks the server to merge or swap; dropping outside the window cancels; dropping onto an occupied multi-cell item targets its top-left cell. Dragging an item out of the bag to the ground (with confirmation) is deferred: the shared protocol only has pickup, not drop, and adding a drop intent would need its own ownership/valuation rules. Auto-loot only sends normal pickups the server already validates; a rejected drop is backed off for four seconds instead of retrying forever. Warehouse deposit/withdraw moves a whole stack, so a player splits first when they want to store part of it. Death closes item actions; the character can still respawn.

## D54 — The admin live bus is in-process and keyed by character

Each `MapRoom` registers a per-character action object after the session registry accepts the join; registration stores the owning session and room, and unregistering is conditional on both, so a late `onLeave` from an old room after a warp cannot remove the new session. Admin routes look the action up immediately before choosing the live or offline path, and a registration race is resolved by the DB path: an offline mutation commits to the database and the join loads it. This assumes one server process; Phase 10 can replace the bus with pub/sub when horizontal scaling lands. Announcements and kicks iterate the registered actions, so they only reach players in this process.

## D55 — Bans bump `tokenVersion`, then kick; the monitor cookie carries the access token

Ban locks the account row, sets `bannedUntil`/`banReason`, increments `tokenVersion`, writes `admin_log`, commits, and only then asks the session registry to kick with reason `"ban"`. The bump invalidates stale reservations, access tokens and refresh tokens before the socket closes, so an in-flight join cannot win the race. Unban clears the fields and does not bump the version. A plain admin kick sends `"admin"` and leaves tokens valid; the client returns to character select rather than the login screen. Because the Colyseus monitor iframe cannot send an `Authorization` header, an admin/gm login also sets an HttpOnly, SameSite=Lax `jt_admin` cookie holding that access token, and every monitor request re-checks its signature, token version, role and ban state. Permanent bans use the sentinel `9999-12-31T23:59:59.999Z` because `NULL` means "not banned".

## D56 — Admin item and gold mutations reuse the existing item pipeline

Live grants/removals run inside the room's inventory chain and apply the same `planAdminGive`/`planAdminRemove` + transaction executor as player actions; offline mutations load, plan and apply against the database. Both paths write `item_log` (`admin_grant`/`admin_remove`) through the transaction, and the route adds an `admin_log` row, so a grant is auditable from both the item history and the admin history. Item UUIDs are never reused, and a +5 grant is an ordinary row with `upgradeLevel: 5`; `effectiveItemStats` already reads the upgrade chain.

## D57 — Rates, metrics, announcements and shutdown scheduling are in-memory

XP/drop event multipliers, the online-history ring buffer, scheduled shutdown state and the announcement registry live in `AdminRuntime`, so they reset on restart and are not shared between processes. They are operational switches rather than persistent game data, and keeping them out of the database avoids a write per history sample. Announcement rows created by an admin are persisted (for history and auditing) while the live delivery list is rebuilt from the database at boot; shutdown sends countdown banners through the same admin bus.

## D58 — Phase 5 game data is read-only and audited admin actions are never deleted

The admin game-data page reads `@jadethrone/data` directly in the browser and has no editing UI: hot-reloadable data editing is a Phase 7 concern. Every mutating admin route writes an `admin_log` row with the actor account, target, action, optional detail and IP before returning; read routes are not logged to keep the table useful and small. Item/gold/chat logs remain append-only and are never pruned by the admin panel.

## D59 — Skill ranks are child rows; rank 0 is represented by absence

Learned skills live in `character_skills` with PK `(character_id, skill_id)`, a `smallint rank` check 1–20 and a cascade FK to `characters`. Rank 0 is never stored: saving it deletes the row, so spent points can be summed with a plain `sum(rank)`. There is no `skills` table and no FK on `skill_id`; definitions stay in `packages/data/skills.json` and existence/class/doctrine checks are code-level. The PK's leftmost column covers per-character loads, so no extra index is needed. `loadSkillRanks` accepts `Db | Tx` for join-time reads; unknown persisted skill ids are skipped with a warning rather than blocking the join. Doctrine, `skill_points` and ranks are written by one `saveSkillState` transaction that locks only the character row (accounts → characters → children order), validates everything before opening the transaction, and never writes a full character snapshot. `characters.skill_points` remains a derived convenience column written only by that path; the bulk autosave path intentionally does not carry skill ranks.

## D60 — Party XP is killer-party based within 1500 px; loot ownership is party-aware but still runtime-only

Kill XP is awarded once per eligible member of the killer’s party (alive, present, within 1500 px of the kill), plus the killer; each member receives `floor(monsterXpGain(...) * (1 + 0.1 × (eligible − 1)) * adminXpRate)`, with the level-gap base floored before the party bonus and rate. A solo killer gets the existing solo value. Level-ups, skill-point recalculation, `selfStats`, level-up broadcasts and per-member saves reuse the solo path, so a two-member kill produces two saves but never a duplicate award. Loot attribution uses the top-damage contributor (D51), but the drop is party-owned: `free_for_all` admits any party member during the 30 s lock; `round_robin` names one character via the registry cursor and blocks the rest. `ownerPartyId` is a runtime permission layer only; `dropOwnerCharacterId` in the DB stores the exclusive character (null for party free-for-all) and is never rewritten on release. If a round-robin owner leaves while the party survives, the drop falls back to party free-for-all; if the party disbands, the lock clears. Locks still expire after 30 s regardless. The DB conditional claim remains the final duplicate-item guard.

## D61 — Stone damage is rolled in combat but applied by the stone manager

Basic attacks select monsters and spirit stones in one nearest-first arc using internal `m:` / `s:` keys, so a monster and a stone can share a raw id without colliding and monster-only ordering/RNG stays unchanged. Stones never miss; they use `StoneInfo.defense` and the normal crit roll, and combat returns stone damage intents without mutating stone HP or credit. The room applies each intent through `StoneManager.damage`, which remains the only writer of stone HP, wave thresholds and respawns. Applying a swing's stone hits immediately (before the next player's swing resolves) prevents two players in one tick from damaging a stone the other destroyed. Top-damage attribution is shared by `topDamageOwner`, which skips contributors who left. Stone respawn randomness uses a separate seeded generator so combat RNG stays reproducible.

## D62 — Boss clocks are messages backed by spawn-group state

`bossStatuses` reads each spawn group whose definition contains a boss, reports whether that boss currently lives in `runtimes`, and exposes the group's absolute `respawnAtMs` while dead. The room broadcasts `bossTimer` after a boss kill, after any group respawn, and on a client `requestBossTimer` (the join-time send can precede the SDK listener). Timer values are server epoch milliseconds so the client can count down without trusting its own spawn timing. Regular packs never produce boss messages.

## D63 — Skill hits reuse the swing damage path; buffs and statuses are intents

`resolveSkillCast` selects monsters and stones with the same `m:` / `s:` candidate keys as basic attacks. `melee_aoe` reuses the shipped 120° arc, `area` uses a clamped circle, `projectile` a clamped line and `dash` a collision-safe destination. Monsters roll hit → skill damage → crit; stones never miss and use `skillDamage` with their defense; overkill credits the full roll and records one kill. Attack buffs scale both physical and magic power, crit remains DEX-based, and lifesteal counts monster damage only. Buff/heal skills never damage players: they target the caster and live party members only, with dead/out-of-range/stale sessions silently skipped. The resolver mutates only monster HP/damage credit and `lastCombatAtMs`; it returns buffs, HoTs, cleanses, stun/slow/poison/knockback, self-damage and dash intents for the room to apply. HP costs leave at least 1 HP; offensive casts break stealth even on a whiff.

## D64 — Skill casts consume MP/cooldown at start and resolve on the tick before monster AI

`castSkill` validates the learned rank, doctrine, level, pending cast, cooldown, MP and resolved aim, then consumes MP/cooldown, stores a pending cast with the server-captured aim/ally/party ids, and sends `skillCastStart`. The tick resolves due casts before monster AI so a killed monster cannot act in the same tick. Monsters take the resulting changes through `MonsterRuntime.status` (stun skips AI, slow scales movement, poison ticks in the skill-effects phase); knockback uses collision-safe displacement. Player buffs live in `PlayerRuntime.buffs`, are refreshed by source skill, pruned each tick, and are cleared on death/warp; HoTs tick in the skill-effects phase. Buff/cleanse changes send `buffState` and refreshed `selfStats`. Offensive casts break stealth and remove the player from monster target snapshots.

## D65 — Co-located targets are always inside the melee arc

A player walks to the float32-rounded stone coordinate exposed in schema state, so the authoritative stone can sit a fraction of a pixel behind the exact facing the client computed from the rounded pair (for example the client sees `dx = 0` and sends east while the stone is 0.0002 px west). The strict `dot < 0` arc test then classified the stone as behind and every subsequent swing missed, even at "distance 0". `isInMeleeArc` now treats targets within 0.01 px as the same point and skips the facing test; this is far below a tile, larger than float32 rounding at any map coordinate, and keeps visibly behind targets rejected.

## D66 — Trades are room-local state machines committed in one DB transaction

The trade registry lives in `rooms/trade.ts`, mints the `tradeId` at invite time (30 s TTL), keys participants by a sorted character-id pair, and keeps one active trade per character from acceptance onward. Any offer change bumps `revision` and clears both locks and accepts; an identical resubmitted offer is a no-op. Locks require an explicit offer (an empty offer counts when submitted) and accepts require both locks. Pending invites are silently replaced per inviter/target, terminal records are retained for 60 s so late clicks get `cancelled`, and open trades expire after 5 minutes idle.

The DB executor locks both character rows in sorted UUID order and all offered item rows in UUID order. It swaps inventory ownership and slots without merging stacks (each instance keeps its UUID, upgrade and bonuses), rejects a full receiver, applies both gold deltas, writes two `gold_log` rows (`reason = trade`, shared tradeId), one `item_log` row per moved stack with the giver as actor, and one `trade_log` snapshot row. Moving rows are parked at unique negative slots before reassignment so two owners can swap the same slot numbers. Zero-delta gold logs are skipped; the `trade_log` still records the offered amounts. Only inventory items can be offered in Phase 7.

## D67 — Game data overrides are per-entry JSON validated against the whole merged graph

Base JSON stays the source of defaults. Admin edits live in `game_data_overrides`, keyed by `(dataset, entry_id)` where the id is the entry's `id`, an upgrade step's `from`, or a bonus's `type`. Merge replaces matching base entries and appends new ids; deleting an override reverts to base and base entries cannot be hidden. The server rebuilds the entire merged catalog through the existing Zod builders (`packages/data/src/catalog.ts`) on every reload and swaps one immutable snapshot reference only after validation succeeds, so an invalid edit can never partially apply and running rooms immediately read the new version from `ServerServices.gameData`.

Rooms and planners accept an optional `CatalogLookup` defaulting to `BASE_CATALOG`, keeping pure tests and non-DB suites independent of Postgres. The DB-backed store performs no query until `ensureLoaded`/`reload`, and the boot path reloads after migrations. Admin writes validate a candidate first, commit the row and `admin_log` audit in one transaction, then reload under the store lock; a post-commit reload failure returns 409 while the previous catalog remains active. Version numbers are process-scoped and restart at 1, so clients must compare inequality rather than ordering. The public `GET /api/data/catalog` returns the merged per-entry arrays and version for the Phase 7 client refresh.

## D68 — The death penalty is saved at death time, not only on leave

Autosave deliberately skips dead players (D44), which meant a crash between death and respawn rolled the 2% XP loss back. `handlePlayerDeath` now enqueues an immediate save with the village destination while `progression.hp` is still 0. The row therefore reads "village, dead", and `progressionFromCharacter` revives it at full HP on the next join — exactly the existing dead-disconnect rule, with no extra branch. `dirty` stays set because the runtime position still differs from the saved town position, so the normal leave/autosave write later replaces it (including a "restart here" in the field).

## D69 — Dash skills sweep their movement in small steps

A single `stepMover` call with a large distance only collision-checks the endpoint, so a 220 px blade charge could tunnel through a 32 px wall that had walkable ground behind it (the `isWalkableAt` guard on the destination passed). Dash resolution now marches the shared mover in 8 px steps until the range is spent or the mover stops moving, then keeps the existing walkable-destination fallback. This reuses the same collision code as walking, so dash endpoints are consistent with what a player could walk to, and the regression test places a solid column between the caster and the aim point.

## D70 — Offline admin item mutations re-check "online" inside the item transaction

`grantItemOffline`/`removeItemOffline` used to load the inventory, check the session registry, then open a separate transaction; a player joining in that gap could have a stale snapshot written over a live inventory. Both now run through `withItemTransaction` and perform the `isOnline` check inside it, so the abort happens after the owner rows are locked and the item plan's expectations are verified in the same transaction. The check result is captured and thrown after the transaction commits (an empty commit) because `withItemTransaction` deliberately rewraps unknown errors as `ItemError`; the route then retries through the live path.

## D71 — Spirit stones are map landmarks, not interest-filtered

Stones are deliberately outside the `StateView` interest pass: they are visible and targetable from far away so a party can see a stone's HP and coordinate before arriving. The client still culls visuals by camera bounds. If Phase 9 adds many stones per map, this becomes a per-client filter, but for the current two maps the "landmark" behaviour is the design.

## D72 — Tier 3/4 gear is intentionally unobtainable until Phase 9

`items.json` ships level-20/30 tier 3 and 4 gear with icons and stats, but no drop table or shop references it yet. Those tiers belong to the Phase 9 maps and level-60 content; shipping the data early lets the catalog, tooltips and upgrade tables be exercised now without adding an out-of-band power source to the 1–15 game.

## D73 — Ember Fields allows PvP during Phase 8

`packages/data/maps/policies.json` marks Ember Fields `pvpAllowed: true`, although the design reserves PvP for the neutral maps arriving in Phase 9. This is deliberate for Phase 8: it is the only populated map, so it is where PvP modes, kingdom hostility, party/guild exclusions and name colours can be tested end to end. Phase 9 flips Fields back to a safe leveling map and moves the flag to the neutral maps.

## D74 — Parties are room-scoped until Phase 9 needs cross-map parties

The party registry lives in `MapRoom` and a warp leaves the party (`leavePartyInternal`). Party chat, XP and loot therefore only work on one map. Phase 8 has no cross-map party content; Phase 9's dungeon needs it, so the registry moves to a process-wide service (like `social`) at that point rather than carrying a half-working cross-room design now.

## D75 — Upgrade and trade previews stay server-driven

The blacksmith preview and trade revision checks are server messages; the client renders what the server planned instead of re-implementing the upgrade table or trade state machine. That avoids stale-preview divergence at the cost of a round trip. Extracting pure `planUpgrade`/`tradeTransition` helpers into `packages/shared` is worthwhile when a second consumer (e.g. a web armory) appears, but duplicating them into the client now would create the drift the review warned about.

## D76 — The client character sheet reads item and buff stat buckets separately

`ITEM_STAT_KEYS` (weapon/armor stats) and `BUFF_STATS` (attack speed, evasion, move speed) are different buckets. The current character sheet shows level, stats, attack, defense and crit; Phase 9's full sheet must merge both buckets through `applyBuffModifiers` so a buffed character's displayed values match combat. Recorded here so the sheet is not built from only one bucket.

## D68 — Phase 8 social routing, guild transactions and PvP rules

Chat is channel-aware server-side. Local chat keeps the 900 px radius and scrambles cross-kingdom text per recipient unless the reader is on a neutral map; shout is same-kingdom, level 15+ and 15 s; whisper/guild chat route through a process-wide `SocialDirectory` keyed by character id, while party chat stays room-local. Profanity is filtered before delivery/logging. Chat history is client-only (100 lines per tab), and `chat_log` stores the channel.

Guilds are DB-backed with case-insensitive unique names, one guild per character, 32-member cap and leader/officer/member permissions. Creation is a single transaction (level 30, 500k gold, guild + leader row + `guild_create` gold log); invites are runtime-only with a 30 s TTL. Guild name/id changes fan out through the social directory so live name plates and friendly-fire checks update without a room restart.

Friends are one-way relationships (add/remove, no request handshake), queried from DB with online state from the social directory. Whisper/online updates are delivered cross-map.

Skill mastery is stored separately from the normal rank in `character_skill_mastery` (M0–M10), because rank is capped at 20. Master levels add effective ranks for damage/heal/buff scaling only; MP cost keeps the normal rank. A generic mastery tome is consumed in the same transaction as the mastery/cooldown update; failed readings still consume the book and start the 12 h cooldown.

PvP uses the shared `canAttackPlayer` matrix: safe maps block all player damage, Peaceful blocks both directions, Kingdom only hits other kingdoms, Free hits anyone non-peaceful, and party/guild members are never valid targets. Player damage reuses the existing hit/crit/defense formulas, has no PvP multiplier, no player statuses, no lifesteal and no PvP rewards; death uses the normal death path. A `pvpReady` gate prevents guildmates being attackable before the async guild lookup completes.

Day/night and weather are client-only: a Phaser 4 camera colour matrix follows the absolute 20-minute shared clock, and bounded particle emitters provide per-map weather. The minimap is generated from the same collision grid, with entity dots updated at 4 Hz; the Phase 8 world map is a policy-driven two-map view until Phase 9 supplies the full world layout.

## D77 — `map_ember_fields` becomes Ember Highlands instead of being renamed

The final map list in GAME_DESIGN.md §3.1 replaces the Phase-1 "Ember Fields"
with three Highlands maps. Renaming `map_ember_fields` would invalidate saved
`characters.map` rows and every drop/stone/spawn-group reference, so the id is
kept and the map is rethemed and relabelled "Ember Highlands" in
`MAP_LABELS`/`policies.json`. It also loses its Phase-8 `pvpAllowed` stand-in
(D73): PvP moves to the neutral Valley of Echoes and Corrupted Forest.

## D78 — Map connections are a validated bidirectional travel graph

`policies.json` now carries a `dungeon` flag and the parser requires every
connection to point back at its source, so travel can never strand a player on a
map with no return path. The dungeon flag also forbids PvP and is what the
server uses to decide that a map is instanced (Phase 9 task 18).

## D79 — Channels are filtered rooms with a peeked warp token

CH1–CH4 are real room shards: every map handler is registered with
`.filterBy(["channel"])`, and Colyseus seeds `metadata.channel` from the join
option, so one room exists per (map, channel) and `joinOrCreate` never invents a
"CH1b" — a full channel rejects at seat reservation instead. The channel is
clamped to 1–4 everywhere a stale value can appear (DB row, join option, token),
never rejected, so a bad column cannot lock a player out. Warp tokens now carry
the channel, and matchmaking only *peeks* at them: a full room is retried up to
five times, so burning the token in `onAuth` would destroy it. `onJoin` consumes
it once the seat is ours. Switching channels reuses `beginWarp` to the same map
at the current position, which keeps the `character.map === options.map` auth
check true and preserves the 2 s anti-ping-pong cooldown.

## D80 — The party registry is process-wide; warps detach instead of leaving

Parties now live in `ServerServices.parties`, so a warp, teleport or dungeon
entry no longer disbands them. A room that removes a warping member only
`detachPartyMember`s it (session id cleared, membership kept); the target room
rebinds the new session in `onJoin` and broadcasts the full party snapshot,
which is how cross-map party frames stay populated. XP and loot eligibility are
still decided per room by looking up `this.runtimes.get(member.sessionId)`, so a
member standing on another map simply contributes nothing. Party chat remains
room-local (the Phase-8 rule); only guild/whisper chat is process-wide.
