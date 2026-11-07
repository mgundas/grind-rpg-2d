# Jade Throne — Progress

Current plan: `docs/plans/phase-3.md` (Phase 3 complete — see `docs/reports/phase-3.md`).

## Phase 0 — Foundation ✅

- [x] Task 1 — Repo init and tracking docs (git init, .gitignore, README, DECISIONS seed)
- [x] Task 2 — pnpm workspace + pinned toolchain catalog
- [x] Task 3 — TypeScript strict base config, ESLint flat config, Prettier
- [x] Task 4 — packages/shared: constants + seeded rng + first Vitest suite
- [x] Task 5 — packages/data skeleton
- [x] Task 6 — server: Colyseus 0.17 skeleton with Express health endpoint
- [x] Task 7 — server: minimal world room with schema state
- [x] Task 8 — docker-compose.yml (Pi deployment), .env.example, scripts/dev-db.mjs
- [x] Task 9 — client: Vite + React + Phaser shell with Boot scene
- [x] Task 10 — client: asset manifest with procedural placeholder fallback
- [x] Task 11 — client: demo world scene with placeholder character + server status overlay
- [x] Task 12 — admin: theme styled login page skeleton
- [x] Task 13 — root dev orchestration and workspace scripts
- [x] Task 14 — CI workflow (.github/workflows/ci.yml)
- [x] Task 15 — ASSETS.md + assets/CREDITS.md skeleton
- [x] Task 16 — final verification, @reviewer pass, phase report
- [x] Phase report: `docs/reports/phase-0.md`

## Phase 1 — Walk together

- [x] Task 1 — shared: direction + movement constants
- [x] Task 2 — shared: Tiled parser + collision grid
- [x] Task 3 — shared: deterministic movement step
- [x] Task 4 — shared: A* pathfinding
- [x] Task 5 — map generator: Ember Village
- [x] Task 6 — map generator: Ember Fields + invariants
- [x] Task 7 — server: map registry, schema v2, join
- [x] Task 8 — server: tick loop + authoritative movement
- [x] Task 9 — server: messages, chat, latency flag
- [x] Task 10 — server: StateView interest
- [x] Task 11 — server: warp between maps
- [x] Task 12 — client: session + guest join
- [x] Task 13 — client: real map rendering
- [x] Task 14 — client: input + prediction
- [x] Task 15 — client: remote interpolation
- [x] Task 16 — client: chat, bubbles, F3 overlay
- [x] Task 17 — client: warp UX
- [x] Task 18 — phase gate: verification, reviewer, report
- [x] Follow-up — local-player render interpolation (20 Hz prediction now looks smooth at display rate)
- [x] Phase report: `docs/reports/phase-1.md`

### Phase 1 — Known issues (minor, deferred)

Found by the second `@reviewer` pass; every IMPORTANT finding was fixed, these are the accepted minors:

- `apps/server/src/rooms/MapRoom.ts` still hardcodes `KINGDOM_IDS` instead of deriving it from `KINGDOMS` in `packages/shared`.
- Balance/tuning constants live in `packages/shared/src/constants.ts` rather than `packages/data`/`formulas.ts`; `KEY_CHARACTER`, `HOLD_TO_STEER_MS`, `CLICK_MAX_MS` and camera `setZoom(2)` are hardcoded in `World.ts`.
- `MapRoom.ts`, `World.ts` and `generate-maps.ts` are still large multi-responsibility files; split movement/chat/interest/warp systems and input/remote/chat/debug controllers in a later refactor.
- `JoinPanel.tsx` calls `void connect(...).finally(...)` without `.catch`, so a rejected join is an unhandled rejection.
- `World.ts` registers the F3 listener inside `ensurePredictor()`; a reconnect without a scene restart can add a second listener and toggle debug twice.
- Scene restart resets predictor/remotes/warp but not `pointerHeld`, `pointerWorld`, `pointerDownAt` or `facing`; a warp while holding the mouse can steer toward a stale pointer.
- The old room's `onLeave` calls the global `stopPingLoop()` unconditionally, so a delayed leave can stop the new room's ping loop.
- `onLeave` does not call `updateInterest()`; the schema delete handles views, but the "recompute on leave" intent is implicit.
- Chat range is 900 px while the interest add radius is 850 px, so a player at 860–900 px receives the chat log without a visible remote/bubble.
- `placeholders.ts` draws tile noise on tile 0 (`addNoise` is called without `offsetX`); cosmetic only.
- Dead code remains: `SPAWN_POINT` (shared), `onChatMessage` (client session), `MAP_NAMES` (map generator).
- `packages/data/test/maps.test.ts` calls `writeMapFiles()` inside a test and mutates the working tree; the committed-file comparison already proves the writer output.
- `MAX_PENDING_INPUTS` drops are counted but not logged; invalid input/chat logging is not rate-limited and can be flooded at 30 msgs/s.
- The chat send loop calls `otherClient.send(...)` without a try/catch; a client leaving mid-iteration can throw.
- All normal joins use the exact map spawn, so two tabs overlap until Phase 2 persistence/character positions.
- Browser look-and-feel checks (smooth remote motion, local interpolation feel, bubbles, y-sorting, fade, 150 ms feel) remain a human pass; automated checks cover state/netcode only.

## Phase 2 — Accounts and characters

Plan: `docs/plans/phase-2.md` (produced after reading the installed Colyseus typings; see the plan for verified API facts).

**Verification note (2026-11-06):** the dev database (`homepi:5452`) is reachable. `drizzle/0000_*.sql` is applied to `jade_throne` and to a dedicated `jade_throne_test`; the 21 real-Postgres persistence tests and the 8 HTTP route tests pass against the test database. Full suite: 29 files, 269 tests, all passing when `TEST_DATABASE_URL` points at the test database. Additional acceptance runs: `scripts/verify-phase2-e2e.mjs` (17/17 PASS against a real server) and the auth-aware `scripts/verify-phase1-e2e.mjs` (15/15 PASS, including both warps and warp persistence). `pnpm seed` was run twice and is idempotent. The real `tsx` server was also exercised over HTTP (register → login → create character → matchmake).

- [x] Task 1 — Dependencies, config, DB schema, migration
- [x] Task 2 — Shared rules, DTOs, class data, HP/MP formulas, new WS messages
- [x] Task 3 — Password hashing and JWT helpers
- [x] Task 4 — Account and character services (DB)
- [x] Task 5 — Session registry, warp token extension, join authenticator (MapRoom wiring in task 7)
- [x] Task 6 — REST routes, middleware, server dependency wiring
- [x] Task 7 — MapRoom: authenticated join, state identity, persistence, kick
- [x] Task 8 — Warp persistence and target-map authentication
- [x] Task 9 — Client API + token storage + auth state
- [x] Task 10 — Client session and screen routing
- [x] Task 11 — Auth screen (login/register, kingdom choice)
- [x] Task 12 — Character select, create, delete, preview
- [x] Task 13 — Layered appearance in the world
- [x] Task 14 — In-game logout and kick UX
- [x] Task 15 — Seed script and verification tooling
- [x] Task 16 — CI Postgres, docs, final verification, reviewer, phase report

Phase report: `docs/reports/phase-2.md`.

### Phase 2 — Known issues (minor, deferred)

- Warp tokens are consumed during matchmaking; a Colyseus seat-reservation retry against a full target room loses the token. Target rooms hold 200 players; revisit with channels/load tests.
- One corrupt character row can block login because `toCharacterSummary` runs inside the login transaction. Rows are validated on write; add a repair path with the admin tools.
- The character's permanent idle squash/stretch tween bobs while standing still (Phase-1 cosmetic).
- Register/login rate limits are not env-configurable; repeated acceptance runs from one IP need a restart or a 15-minute wait.
- `MapRoom.ts` (~640 lines) and `accountService.ts` still mix several responsibilities; split persistence/session/auth sub-services in a later refactor.
- Known Phase-1 minors remain: chat range 900 vs interest-add 850, per-message invalid-input/chat warnings, and the 2 s warp leave timeout.

## Phase 3 — Combat and monsters

Plan: `docs/plans/phase-3.md` (verified against the installed Colyseus schema and Phaser 4 typings).

- [x] Task 1 — Shared: combat formulas, regen, XP and RNG interface
- [x] Task 2 — Shared: combat protocol messages and arc geometry
- [x] Task 3 — Data: monsters, spawn groups and class attack profiles
- [x] Task 4 — Shared/map: typed mob zones and assets
- [x] Task 5 — Server: schema (monsters, HP/MP/dead), runtime fields and RNG seam
- [x] Task 6 — Server: monster AI state machine
- [x] Task 7 — Server: spawn manager and deterministic placement
- [x] Task 8 — Server: wire monsters into MapRoom and interest
- [x] Task 9 — Server: player arc attack and combat events
- [x] Task 10 — Server: monster attacks and player death
- [x] Task 11 — Server: regen and respawn options
- [x] Task 12 — Server: XP, level-up and stat allocation
- [x] Task 13 — Server: full character-state persistence
- [x] Task 14 — Client: monster rendering and interpolation
- [x] Task 15 — Client: targeting, attack input and server-driven auto-walk
- [x] Task 16 — Client: HUD, target frame, character window and death screen
- [x] Task 17 — Client: combat feel (numbers, flash, knockback, shake, corpses)
- [x] Task 18 — Phase gate: verification, reviewer, report

Phase report: `docs/reports/phase-3.md`.

**Gate verification (2026-11-06):** `pnpm typecheck`, `pnpm lint`, `pnpm build` pass; full suite 38 files / 361 tests pass (28 skipped without a test DB); the 22 real-Postgres persistence tests pass against `jade_throne_test`; `node scripts/smoke-server.mjs` boots the real `tsx` server with both map rooms and `db: "up"`; `pnpm verify:phase3-grind` passes (3-hit level-1 kill, ≈19.8 s level-10 pack, ≈59 min to level 10).

**Temporary gap (closed by Task 13):** town respawn and disconnect-while-dead now persist full HP/MP/XP through `CharacterSave`; the DB roundtrip test covers the full payload (run against the test database when `TEST_DATABASE_URL` is set).

## Phase 4 — Items and economy

Plan: `docs/plans/phase-4.md`.

- [x] Task 1 — Shared item domain and inventory grid
- [x] Task 2 — Item definitions data
- [x] Task 3 — Drop tables, shops, NPCs and monster wiring
- [x] Task 4 — Protocol additions
- [x] Task 5 — DB schema and migration
- [x] Task 6 — Item loading, normalization and starter kit
- [x] Task 7 — Inventory mutation persistence
- [x] Task 8 — Pickup and gold persistence
- [x] Task 9 — Shop and warehouse persistence
- [x] Task 10 — Service wiring and room-test fakes
- [x] Task 11 — Runtime inventory, join load, snapshots and command queue
- [x] Task 12 — Equipment stats and server-side visual keys
- [x] Task 13 — Drops, ground items and ownership
- [x] Task 14 — Pickup, gold credit and auto-loot support
- [x] Task 15 — Consumables and return scroll
- [x] Task 16 — NPC dialog and shops (server)
- [x] Task 17 — Warehouse (server)
- [x] Task 18 — Client store, item icons and inventory UI
- [x] Task 19 — Client equipment panel and visual layers
- [x] Task 20 — Client hotbar, consumables and gold HUD
- [x] Task 21 — Client ground items, pickup FX and auto-loot
- [x] Task 22 — Client NPC dialog, shop and warehouse UI
- [x] Task 23 — Verification tooling and docs
- [x] Task 24 — Phase gate

**Gate verification (2026-11-07):** `pnpm typecheck`, `pnpm lint`, `pnpm build` pass. Full suite against `jade_throne_test` (constructed from the local Postgres env): **55 files / 513 tests pass**, including the real-Postgres transaction, pickup, shop, warehouse and repair tests. `pnpm verify:phase4-economy` passes; the live `node scripts/verify-phase4-e2e.mjs` run against the real server passed starter inventory, NPC dialog, shop buy/sell, warehouse deposit and cross-character withdraw. `scripts/smoke-server.mjs` boots both map rooms with `db: "up"`.

## Phase 5 — Admin panel

Plan: `docs/plans/phase-5.md`.

- [x] Task 1 — Shared admin contracts, protocol and error codes
- [x] Task 2 — Database schema + migration
- [x] Task 3 — Role guard and monitor cookie auth
- [x] Task 4 — Admin read service
- [x] Task 5 — Pure admin item planners
- [x] Task 6 — Admin mutation service
- [x] Task 7 — Live admin bus + service wiring
- [x] Task 8 — MapRoom registration and live admin actions
- [x] Task 9 — GM commands and chat logging
- [x] Task 10 — Admin runtime: rates, metrics, announcements, shutdown
- [x] Task 11 — Admin read routes
- [x] Task 12 — Admin mutation routes
- [x] Task 13 — Admin announcement/control routes
- [x] Task 14 — Colyseus monitor mount
- [x] Task 15 — Client announcement banner and kick reasons
- [x] Task 16 — Admin app foundation
- [x] Task 17 — Admin dashboard and Live Rooms pages
- [x] Task 18 — Admin player search and detail
- [x] Task 19 — Admin player actions
- [x] Task 20 — Admin announcements, server controls, game data
- [x] Task 21 — Admin logs page
- [x] Task 22 — Verification tooling and docs
- [x] Task 23 — Phase gate

**Gate verification (2026-11-07):** `pnpm typecheck`, `pnpm lint` and `pnpm build` pass. Full suite against `jade_throne_test`: **68 files / 595 tests pass**, including the new ban-versus-stale-registration regression, the admin XP-multiplier room test and the persisted rate-audit assertion. `pnpm verify:phase5-e2e` against the live dev server passes all **20 checks** (admin login, monitor cookie 200/401, dashboard presence, live +5 sword, announcement banner, ban kick + 403 login, unban + login, audit rows). `@reviewer` findings were fixed before this gate. Report: `docs/reports/phase-5.md`.

## Phase 6 — Spirit stones, skills, parties

Plan: `docs/plans/phase-6.md`.

- [x] Task 1 — Phase 6 shared protocol and formulas
- [x] Task 2 — Skills data loader + Warrior skills
- [x] Task 3 — Assassin skills
- [x] Task 4 — Hexblade skills
- [x] Task 5 — Mystic skills and completeness
- [x] Task 6 — Spirit stone data and drop table
- [x] Task 7 — Preserve stone zones in map assets
- [x] Task 8 — Admin read-only Skill/Stone tabs
- [x] Task 9 — `character_skills` table and service
- [x] Task 10 — Doctrine, skill points and skills in progression/save
- [x] Task 11 — Doctrine selection and skill upgrades
- [x] Task 12 — Pure party registry
- [ ] Task 13 — Room party integration
- [ ] Task 14 — Party XP and loot rules
- [ ] Task 15 — Pure stone manager
- [ ] Task 16 — Combat damage refactor and stone targets
- [ ] Task 17 — Room spirit stone integration
- [ ] Task 18 — Field boss timer server
- [ ] Task 19 — Client stone rendering, targeting and boss timer
- [ ] Task 20 — Pure skill validation and cast state
- [ ] Task 21 — Buff/status model
- [ ] Task 22 — Pure skill combat resolution
- [ ] Task 23 — Room skill casting and buff integration
- [ ] Task 24 — Client network and store fields
- [ ] Task 25 — Skill window and doctrine selection
- [ ] Task 26 — Two-row hotbar and skill casting
- [ ] Task 27 — Skill FX, cast bar and buff bar
- [ ] Task 28 — Party window, frames and invite-by-click
- [ ] Task 29 — Phase 6 E2E, decisions and report
- [ ] Task 30 — Phase gate

## Later phases (from GAME_DESIGN.md §12)

- [x] Phase 4 — Items and economy → see the Phase 4 section above
- [x] Phase 5 — Admin panel (see the Phase 5 section above)
- [ ] Phase 6 — Spirit stones, skills, parties
- [ ] Phase 7 — Upgrades, bonuses, trading
- [ ] Phase 8 — Social and progression depth
- [ ] Phase 9 — The wider world
- [ ] Phase 10 — Polish, performance and deployment
