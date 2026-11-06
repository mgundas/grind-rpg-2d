# Jade Throne — Progress

Current plan: `docs/plans/phase-1.md` (Phase 1 complete and re-verified after a second `@reviewer` pass — see `docs/reports/phase-1.md`).

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

**Verification note (2026-11-06):** the configured dev database (`homepi:5452`) was unreachable and Docker is not installed on this machine, so applying `drizzle/0000_*.sql` and the 20 real-Postgres tests in `apps/server/test/db/persistence.test.ts` are still pending. They are skipped without `TEST_DATABASE_URL`; everything else passes.

- [x] Task 1 — Dependencies, config, DB schema, migration
- [x] Task 2 — Shared rules, DTOs, class data, HP/MP formulas, new WS messages
- [x] Task 3 — Password hashing and JWT helpers
- [x] Task 4 — Account and character services (DB)
- [x] Task 5 — Session registry, warp token extension, join authenticator (MapRoom wiring in task 7)
- [ ] Task 6 — REST routes, middleware, server dependency wiring
- [ ] Task 7 — MapRoom: authenticated join, state identity, persistence, kick
- [ ] Task 8 — Warp persistence and target-map authentication
- [ ] Task 9 — Client API + token storage + auth state
- [ ] Task 10 — Client session and screen routing
- [ ] Task 11 — Auth screen (login/register, kingdom choice)
- [ ] Task 12 — Character select, create, delete, preview
- [ ] Task 13 — Layered appearance in the world
- [ ] Task 14 — In-game logout and kick UX
- [ ] Task 15 — Seed script and verification tooling
- [ ] Task 16 — CI Postgres, docs, final verification, reviewer, phase report

## Later phases (from GAME_DESIGN.md §12)

- [ ] Phase 3 — Combat and monsters
- [ ] Phase 4 — Items and economy
- [ ] Phase 5 — Admin panel
- [ ] Phase 6 — Spirit stones, skills, parties
- [ ] Phase 7 — Upgrades, bonuses, trading
- [ ] Phase 8 — Social and progression depth
- [ ] Phase 9 — The wider world
- [ ] Phase 10 — Polish, performance and deployment
