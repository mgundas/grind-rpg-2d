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
