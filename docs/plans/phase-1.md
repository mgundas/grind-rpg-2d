# Jade Throne — Phase 1 (Walk together) — Builder Handoff

Phase 0 is complete (`docs/reports/phase-0.md`). This plan was produced after reading `AGENTS.md`, `GAME_DESIGN.md` (§5, §9, §10, §12), the current code, and the installed typings; the netcode system was designed with a single `@architect` consult as `AGENTS.md` requires (no second consult for the same system).

**Scope (GAME_DESIGN §12):** map generator producing Ember Village + Ember Fields in Tiled JSON; client renders all layers with y-sorting; server builds the collision grid from the same files; guest join; click-to-move A* + WASD; client prediction/reconciliation; interpolation for others; StateView interest management; camera follow; local chat + bubbles; warp between village and fields; FPS/ping overlay on F3.

**Acceptance:** two browser tabs see each other moving smoothly with no jitter; collisions identical on client and server; chat works; warping works; simulated 150 ms latency still feels smooth for the local character.

**Out of scope (do not build):** NPC behaviour, mobs, combat, items, persistence, auth (Phase 2+). The generator _emits_ `mob_zone`/`stone_zone`/`npc` objects but the server only parses them. No reconnect tokens (fresh guest join on disconnect).

## Verified platform facts (from installed `.d.ts` + docs)

- Colyseus 0.17: `setSimulationInterval(cb, 50)`, `patchRate = 50`, `onMessage(type, zodSchema, cb)` (Zod 4 is Standard Schema), `broadcast`/`client.send`, `this.clock`, `Room.roomName`.
- StateView (schema 4): `client.view = new StateView()`, tag the collection via `@type({ map: PlayerState, view: true })`, then `view.add(player)` / `.remove(player)`; client gets `onAdd`/`onRemove`. `addParentOf` includes ancestors.
- Client SDK `@colyseus/sdk` 0.17.43: `new Client(url)`, `joinOrCreate<T>(name, opts)`, `room.onStateChange`, `room.send/onMessage`, `room.ping(cb)`, `consumeSeatReservation`, `Callbacks.get(room)` → `.onAdd/.onRemove/.listen`.
- Warp: `matchMaker.joinOrCreate(targetMap, options) → ISeatReservation`; fallback `matchMaker.query({name}) + reserveSeatFor`.
- Latency simulation: `server.simulateLatency(ms)` (Server.d.ts:141).
- Phaser 4.2.1: `this.input.on("pointerdown", p => p.worldX/p.worldY)`, `keyboard.createCursorKeys()`, `addKeys("W,A,S,D")`, camera `startFollow/setBounds/setZoom`, `load.tilemapTiledJSON`, `map.addTilesetImage`, `map.createLayer`.
- Maps are imported as JSON modules (bundled by tsx/esbuild/Vite), so the client and server parse the exact same bytes with no runtime path resolution.

## Architecture decisions

1. **One room type per map** (`map_ember_village`, `map_ember_fields`), per GAME_DESIGN §10.2; warp = seat reservation, no shared room switching.
2. **Server-authoritative movement.** Clients send intents only. No position ever crosses the wire. Each input is stepped **exactly one 50 ms tick**, so delayed inputs still produce identical total movement.
3. **Click-to-move** sends a `path` intent each tick while walking; the server recomputes A* from its current position for each intent (making reconciliation replay exact).
4. **WASD** sends one `dir` intent per fixed tick while held; releasing sends one `none`. Hold-to-steer reuses `dir` (no per-tick A*).
5. **Ack in state** (`lastSeq`), so `(x, y, lastSeq)` arrive atomically in one patch. Snap > 64 px, else visual offset decays over 100 ms.
6. **Remote interpolation** renders 100 ms in the past from position samples keyed by local receipt time; no extrapolation; > 200 px discontinuity snaps.
7. **Interest management** tags the `players` collection and adds/removes instances per client (`StateView`), with 850/900 px hysteresis, recomputed every 250 ms and on join/leave.
8. **Determinism**: `INV_SQRT2` is a literal; the movement step uses only arithmetic/comparisons/table lookups (no `Math.hypot`/trig); fixed iteration order.
9. **Guest names** need not be unique until Phase 2.

## Task list

Each task must type-check, run its tests, tick `PROGRESS.md`, and commit.

1. **Shared: direction + movement constants** — `packages/shared/src/{constants,direction,index}.ts`, `packages/shared/test/direction.test.ts`. `Dir8`, `Facing4`, `DIR8_VECTORS` (diagonals pre-scaled by `INV_SQRT2`), `dir8FromAxes`, `dir8Towards`, `facing4FromDir8`; constants for speed, interest, interpolation, snap, chat, warp, path budget, `ROOM_NAME_*`, `MapId`.
2. **Shared: Tiled parser + collision grid** — `packages/shared/src/{tiled,collision}.ts`, `packages/shared/test/fixtures/mini-map.json`, tests. Strict zod Tiled subset (`ground/decor/above/collision` + `objects`), `extractMapObjects`, `buildCollisionGrid`, `rectOverlapsSolid`, `isWalkableAt`, `nearestWalkable`. Out-of-bounds is solid.
3. **Shared: deterministic movement step** — `packages/shared/src/movement.ts`, tests. Pure `stepMover` with axis-separated collide-and-slide over the feet AABB, waypoint following, bounds clamp.
4. _*Shared: A* pathfinding_* — `packages/shared/src/pathfinding.ts`, tests. Deterministic A* (fixed neighbour order, octile heuristic, heap tie-break), no corner slicing, `nearestWalkable` fallback, budget cap, `simplifyPath`/`hasLineOfWalk` (supercover raycast).
5. **Map generator: Ember Village** — `scripts/generate-maps.ts`, `packages/data/maps/map_ember_village.json`, root `generate:maps` script, `.prettierignore` map entry. Seeded 80×80 map: plaza, roads, houses, river + bridge, fences, tree border, east warp to fields, spawn object, collision layer.
6. **Map generator: Ember Fields + invariants** — fields part of the script, `map_ember_fields.json`, `packages/shared/test/maps.test.ts`. 160×160 fields, west warp back, placeholder object layers. Tests: spawn walkable, solid border, spawn↔warps connectivity, warp targets walkable in the target map, byte-identical regeneration.
7. **Server: map registry, schema v2, join** — `apps/server/src/maps/mapRegistry.ts`, `rooms/state/WorldState.ts`, `rooms/MapRoom.ts` (replaces `WorldRoom.ts`), `app.config.ts`, room join test. JSON map import + parse; spawn guard; `client.view` set before state; registrations for both rooms.
8. **Server: tick loop + authoritative movement** — `rooms/playerRuntime.ts`, `MapRoom.ts`, room movement tests. Input queue, seq drop, one-tick stepping, path persistence, 3-tick grace, state write-back epsilon.
9. **Server: messages, chat, latency flag** — `packages/shared/src/protocol.ts`, `MapRoom.ts`, `app.config.ts`, `config.ts`, `.env.example`, tests. Zod `onMessage`; chat range/cooldown; `SIMULATE_LATENCY_MS`.
10. **Server: StateView interest** — `MapRoom.ts`, interest test. Own always visible; add ≤ 850 px, remove > 900 px; 250 ms clock + join/leave.
11. **Server: warp** — `MapRoom.ts`, warp test. Reservation via `matchMaker.joinOrCreate`, removal from old room, cooldown, failure recovery.
12. **Client: session + guest join** — `network/session.ts`, `ui/JoinPanel.tsx`, `ui/store.ts`, `ui/App.tsx`, `.env.example`. Connect/join, input/chat senders, ping loop, warp consumption, store state.
13. **Client: real map rendering** — `scenes/Preload.ts`, `scenes/World.ts`, `public/assets/manifest.json`. Load both `.json`, parse + build grid, render layers, y-sort, zoom + follow.
14. **Client: input + prediction** — `state/predictor.ts`, `World.ts`, tests. 50 ms accumulator, history, reconcile/replay, snap/smooth, input precedence (chat > WASD > hold-steer > click path > idle).
15. **Client: remote interpolation** — `state/remotes.ts`, `World.ts`, tests. `Callbacks.get` wiring, sample buffer, render at −100 ms, teleport snap, nameplates/shadows.
16. **Client: chat, bubbles, F3 overlay** — `ui/Chat.tsx`, `ui/DebugOverlay.tsx`, `World.ts`, store. Focus model, bubbles, FPS/ping/ack/snap/visible counters.
17. **Client: warp UX** — `World.ts`, `network/session.ts`, `App.tsx`. Fade out → leave → consume reservation → scene restart → fade in.
18. **Phase gate** — full gates, two-tab manual matrix + 150 ms run, `@reviewer`, fix findings, `DECISIONS.md`, `PROGRESS.md`, `docs/reports/phase-1.md`, stop.

## Test plan

- **Shared:** direction mapping; movement determinism + wall/corner/door/bounds; A* straight/detour/unreachable/corner-slice/determinism/budget; collision AABB + nearest-walkable; Tiled rejection cases; protocol validation; chat range boundaries; map invariants/determinism.
- **Client:** interpolation (lerp/clamp/hold/out-of-order/teleport); predictor replay against a virtual server (jitter, divergence → no false snaps; 100 px divergence → snap; history cap).
- **Server:** `@colyseus/testing@0.17.11` — join/spawn; exact 4-tick movement; stale/duplicate seq; wall stop equals the shared step; click path arrival; invalid payloads harmless; chat range/cooldown; `view.has` near/far/own; warp message + removal; 3-tick stop.

## Acceptance verification

| Criterion                               | Verification                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Two tabs move smoothly, no jitter       | Manual two-tab walk (WASD + click) 30 s, F3 ping/snap; room test two clients; interpolation unit tests |
| Collisions identical                    | Shared determinism tests; room test compares server position to `stepMover`; manual walls/river/bridge |
| Chat works                              | Room test range/cooldown; manual bubbles + log + out-of-range silence                                  |
| Warping works                           | Room test removal + reservation; manual both directions with fade                                      |
| 150 ms latency smooth for own character | `SIMULATE_LATENCY_MS=150` manual (F3 ~300 ms RTT, no snap-spam); predictor jitter test                 |
| Commands always work                    | `pnpm typecheck/lint/format:check/test/build` + `scripts/smoke-server.mjs`                             |

## Risks

1. **StateView semantics**: if the tagged `players` map does not filter, interest no-ops. Guard: room test on `client.view.has`; degrade gracefully; one-line fix / `view.subscribe`.
2. **Zod-validated `onMessage` on invalid payloads**: pin drop-vs-throw with a test; fallback = plain handler + `safeParse` + log.
3. **`@colyseus/testing` 0.17 API**: read its installed types when adding; behaviour also covered by pure tests.
4. **Seat reservation lifecycle**: unconsumed reservations not fully documented; warn after 10 s; fallback `reserveSeatFor`; client recovery path.
5. **Map JSON imports**: bundles grow by a few hundred KB; fallback `?url` + fetch.
6. **Phaser Tiled loader**: embedded tileset name must map to our texture key; verify with the small fixture first.
7. **Message budget**: inputs only while active + one `none`; chat 1/s. Raise the shared limit if needed.
8. **Determinism drift**: no trig/hypot in the step; fixed iteration order; predictor test guards.
9. **Backgrounded tabs**: delta cap 250 ms; server grace stop.
10. **Windows manual testing**: multi-tab + latency steps documented in the report.
