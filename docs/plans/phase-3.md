# Phase 3 — Combat and monsters

Plan produced after reading `AGENTS.md`, `GAME_DESIGN.md` (§5.1, §6, §11, §12), `PROGRESS.md`, `DECISIONS.md`, and tracing the installed Colyseus schema and Phaser 4 typings.

## Verified library facts

- `@colyseus/schema@4.0.31`: `@view()` tags a whole collection; `StateView` exposes `add/remove/has/clear`; `MapSchema` implements `Map` (`entries`, `delete`, `forEach`); one `client.view` filters every view-tagged collection, so monsters share the existing mechanism.
- `@colyseus/core@0.17.56`: `setSimulationInterval` + `clock.setInterval` are already used the way Phase 3 needs.
- Phaser `4.2.1`: `Phaser.Input.Keyboard.JustDown`, `camera.shake(duration, intensity)`, `sprite.setTintFill()`, and — v4 change — **`camera.postFX` does not exist**; grayscale is `camera.filters.internal.addColorMatrix()` then `.colorMatrix.grayscale(1)`. Particles are `this.add.particles(x, y, key, config).explode(n)`.
- `@colyseus/testing@0.17.11` room tests already have a fake auth/save seam (`apps/server/test/rooms/fakes.ts`), extended in Phase 3 with a seeded RNG and short respawn timings.

## 1. What already exists

**Server**

- `MapRoom` runs a 20 Hz `tick()` (`stepPlayer` → `checkWarps`), registers Zod-validated `input`/`chat` handlers, and keeps a per-client `StateView` with 850/900 px hysteresis (`updateInterest`, 4 Hz).
- `stepPlayer` applies at most one queued intent per tick, uses `stepMover` and `findPath`, and writes `x/y/facing/moving/lastSeq` into `PlayerState`.
- `PlayerRuntime` is the server-private state bag: mover, pending inputs, cooldowns, warp flags, dirty flag, save chain.
- `WorldState` has `PlayerState` and a view-tagged `players` map. No HP/MP, no monsters.
- `MapAssets` parses Tiled maps and exposes `grid`, `warps`, `spawn`, but drops `mobZones` even though the fields map contains three `mob_zone` rectangles.
- Persistence saves only `mapId/x/y`; `CharacterRecord` already carries `hp`, `mp`, `xp`, `level`, stats, `statPoints`, `gold`.
- `ServerServices` is the test seam; `createGameServer(deps)` injects fakes without a database.
- Warp machinery (save destination → seat reservation → warp token) is reusable for "restart in town".

**Shared**

- `formulas.ts` has only `maxHp`/`maxMp`; `protocol.ts` has movement/chat/warp/kick only; `movement.ts`, `pathfinding.ts`, `collision.ts`, `direction.ts` are deterministic and suitable for monster AI.
- `tiled.ts` returns raw `mob_zone` objects.

**Data**

- `classes.json` + Zod-validated `classes.ts`; no `monsters.json`, `spawnGroups.json`.
- Map generator produces three mob zones and one unused `stone_zone`.

**Client**

- `WorldScene` renders the map, predicts movement, interpolates remote players, handles chat bubbles and F3. Zustand `useUiStore` bridges Phaser and React.
- Placeholder system supports `kind: "mob"`, but the manifest has no mob keys.
- No combat input, damage numbers, HP bars, target frame, death screen or character window.

**Out of scope:** drops/gold/inventory (Phase 4), spirit stones (Phase 6), skills/doctrines/parties (Phase 6), PvP (Phase 8). `goldMin/goldMax/dropTableId` are inert until Phase 4.

## 2. Decisions to record in DECISIONS.md

1. Formulas follow GAME_DESIGN §4.4 exactly; all live in `packages/shared/src/formulas.ts`.
2. `characters.xp` stores progress inside the current level; no migration; over-full values level up on load.
3. `RandomSource` is injected: seeded `mulberry32` for tests/scripts, crypto in production.
4. Click-to-attack uses server-driven movement; the client stops predicting while auto-walking.
5. Combat FX are events, not state: `combat`, `monsterDied`, `levelUp`, `death`, `selfStats`, `autoWalk`.
6. Basic attacks exist for all four classes, tuned per spec for Warrior/Assassin; class range/cooldown/max-targets live in `classes.json`.
7. The killing blow gets XP in Phase 3 (party XP is Phase 6).
8. Leaving while dead saves "restart in town" (village spawn, full HP); a corrupt `hp <= 0` row is revived on join.

## 3. Task list

1. Shared combat formulas (`formulas.ts`, `rng.ts`, `constants.ts`, tests).
2. Shared combat protocol and arc geometry (`combat.ts`, `protocol.ts`, tests).
3. Monster and spawn-group data (`monsters.json`, `spawnGroups.json`, loaders, class attack profiles, tests).
4. Typed mob zones and map plumbing (`tiled.ts`, generator, `mapRegistry.ts`, tests).
5. Server schema, runtime and RNG seam (`WorldState.ts`, `monsterRuntime.ts`, `playerRuntime.ts`, `util/random.ts`, `services.ts`, `server.ts`).
6. Monster AI state machine (`monsterAi.ts`, unit tests).
7. Spawn manager and deterministic placement (`spawnManager.ts`, tests).
8. Wire monsters into `MapRoom` (spawn, interest, tick order; room tests).
9. Player arc attack (`combat.ts`, `combatEvents.ts`, room tests).
10. Monster attacks and player death (combat, room tests).
11. Regen and respawn (`here`/`town`) (regen/combat, room tests).
12. XP, level-up and stat allocation (combat, tests).
13. Extend persistence to full character state (`CharacterSave`, services, fakes, DB tests).
14. Client monster rendering and interpolation (`monsterRegistry.ts`, World, manifest, tests).
15. Client targeting, attack input and auto-walk (World, session, store, tests).
16. Client HUD, character window and death screen (React UI).
17. Client combat feel (damage numbers, flash, knockback, shake, hit stop, corpses, level-up).
18. Phase gate: reviewer, verification scripts, docs, report.

## 4. Hard systems

### 4.1 Monster AI

States `idle → chase → attack → return → idle`. Per tick: sleep gate (no living player within 1200 px), leash check, target validation/retarget, attack when in range and off cooldown, chase with repath at most every 500 ms when the target changes tile, return home invulnerable and heal to full, idle wander within 96 px every 4–8 s. Aggressive monsters aggro by proximity; passive only when damaged. Damaging one member aggros the whole group. `onLeave` removes that session from monster targets.

### 4.2 Player attack / arc

`MSG.attack { dir?: 0..7 }`; server validates alive/not warping/cooldown, optionally sets 4-facing, `findArcTargets` uses the facing axis, range + 16 px padding, `dot > 0` back-check, 60° half-angle, sorted by distance with id tie-break, capped by the class profile. Each target: hit roll → miss; crit → ×2. Returning/dead monsters skipped. One `combat` event per swing.

### 4.3 Click-to-attack

`MSG.setTarget { monsterId }` validated (exists, alive, not returning, within 1000 px). Out of range the server drives a path (repath every 250 ms or when the monster changes tile); in range it stops and faces. Give up after 1.5 s without improvement or 3 empty paths. Any movement input cancels in the input phase. The client stops predicting while `autoWalk` is active and recreates the predictor at the authoritative position on cancel.

### 4.4 Spawn groups

`spawnGroups.json` keyed by the map's `spawnGroupId`; the `mob_zone` rect is the placement area. Leader at the centre snapped with `nearestWalkable`; members on a seeded shuffled ring 48–72 px, validated with `isWalkableAt`, ≥40 px from players, ≥24 px from other monsters, 12 random fallbacks. Respawn only after the last death, 30–60 s (boss 20 min), rolled once per wipe. Ids include generation.

### 4.5 Persistence

Extend the save payload, not the schema. Mark dirty on movement/HP/MP/XP/level/stats/points; autosave 60 s, leave, kick, warp, level-up, stat allocation. Save chain semantics unchanged. Join clamps HP/MP and revives `hp <= 0`. Leaving while dead saves village spawn at full HP/MP.

### 4.6 Networking / anti-cheat

All inbound messages use Zod `safeParse`; cooldown, range, arc, target validity, respawn timing, stats and caps are server-checked. Combat events are interest-filtered at 900 px, one per swing, with `eventSeq`, and `client.send` wrapped in try/catch. HP/MP are public state; XP/stats are owner-only messages.

## 5. Tests

- Shared formulas, arc geometry, protocol schemas.
- Data validation/cross-references, class profiles, mob-zone parsing, placement determinism.
- Server AI transitions, leash/return healing, sleep, pack aggro, cooldown, arc selection, death loss, respawn gating, stat allocation.
- Room tests: spawn/visibility/chase, attack→damage→death→XP→level, spam, click-to-attack, respawn, save-on-level-up, dead disconnect.
- Client: monster interpolation, pick radius, level colours, predictor re-create, senders.
- DB: full `CharacterSave` roundtrip, warp/level persistence.
- Balance: Warrior kills a level-1 monster in 2–3 hits; level-10 player clears five same-level monsters in ≈20 s.

## 6. Acceptance verification

- **Grind 1→10:** `scripts/verify-phase3-grind.mjs` with real data/formulas; room test kill→XP→level; e2e kills a monster and reloads with XP/HP intact; manual run recorded.
- **Combat feel:** manual checklist (flash, numbers, crit shake, knockback, hit stop, death fade, level-up banner).
- **Leash:** AI unit + room test (aggro → chase → leash → return invulnerable → full heal).
- **Formula tests:** `pnpm test`.
- **Whole phase:** typecheck, lint, test, build, dev, `verify-phase3-e2e.mjs`, `@reviewer`, Phase 1/2 scripts.

## 7. Risks

1. Formula drift — encode §4.4 verbatim with tests.
2. Tick/A* cost — sleep gate, repath cadence, per-tick budget.
3. StateView visibility lag — `updateInterest()` after spawn.
4. Mutation during iteration — two-phase resolve/apply, spawns after combat.
5. Auto-walk rubber-banding — server-driven mode, predictor recreation.
6. Double XP/death — sequential damage, skip `hp <= 0`, one death pass.
7. Persistence contract change — update all call sites in one task; DB roundtrip test.
8. Timing-flaky tests — inject short windows through `ServerServices`.
9. Balance — all numbers in data/formulas; grind simulation before the gate.
10. Canvas clicks vs HUD — 24 px world pick; HUD opts into pointer events.
11. Phaser 4 API — `camera.filters`, not `postFX`; guard WebGL.
12. Dead/disconnect edges — town/full save, retryable town respawn, warps clear targets.
13. Scope creep — no drops/gold/inventory/spirit stones/skills.
