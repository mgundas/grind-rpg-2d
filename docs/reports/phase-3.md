# Phase 3 — Combat and monsters

Phase 3 is complete on the server and client: monsters spawn in packs, sleep, chase, leash and respawn; basic attacks are server-authoritative and multi-target; HP/MP/XP/levels/stats persist; the client renders monsters, targets, auto-attacks, shows a HUD/target frame/character window and a death screen with both respawn options.

## What was built

**Shared / data**

- Combat formulas from GAME_DESIGN §4.4: XP curve, physical attack, damage roll, hit, crit, level-gap XP, death loss, regen, multi-level XP gain. Injected `RandomSource` (crypto in production, seeded in tests).
- Trig-free 120° arc selection, all combat messages/payloads, typed `mob_zone` parsing, and a dedicated field-boss zone.
- Ten monsters (Wild Dog → Wolf King), four spawn groups, and per-class basic-attack profiles in `packages/data`.

**Server**

- `MonsterState` + view-tagged `monsters`; one spawn manager per room; deterministic pack placement, pack aggro and respawn after the last death.
- Monster AI: sleep within 1200 px, aggressive/passive aggro, 500 ms budgeted chase repaths, leash/return with full heal, unstuck/give-up rules.
- Player attacks: cooldown, facing, arc multi-hit, hit/miss/crit, damage, kill removal, event fan-out, kill XP and level-up.
- Monster attacks, player death, 2% XP loss, 3 s regen (2%/0.5% HP, 2% MP), `here`/`town` respawns.
- Full `CharacterSave` persistence (position, HP/MP, XP, level, stats, points), dead-disconnect saves the town at full HP, duplicate joins reload the kick-saved row.
- Client-click auto-walk: server pathing to the target, auto-attack in range, give-up/unreachable handling, cancellation on any input.

**Client**

- Monster rendering with 100 ms buffered interpolation, level-coloured nameplates, HP bars, placeholders from `mob.*` keys.
- Space attack (optimistic swing + class cooldown), click-to-target/attack, Tab selection, server-driven auto-walk rendering with predictor re-seeding.
- HUD (level/HP/MP/XP), target frame, draggable character window with stat allocation, death screen with countdown and grayscale backdrop.
- Combat feel: pooled damage numbers, miss/crit colours, hit flash, 8 px monster knockback, crit shake + 40 ms hit-stop, corpse fade/puff, level-up banner/pillar.

## How to run

```bash
pnpm install
pnpm dev
```

Open the client (Vite), register, create a Warrior or Assassin, and walk east through the Ember Village warp into Ember Fields.

- `WASD`/arrows or click to move.
- `Space` swings in the facing direction; it hits every monster in the 120° arc.
- Click a monster to walk to it and auto-attack; any movement input cancels.
- `Tab` cycles visible monsters (client-side selection/target frame).
- `C` opens the character window; `Escape` closes it.
- `F3` toggles the debug overlay.
- Death screen: `Restart here` after 10 s at 30% HP, or `Restart in town` immediately.

## Verification

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node --import tsx scripts/verify-phase3-grind.mjs
```

Results at the phase gate:

- `pnpm typecheck` — pass (all packages).
- `pnpm lint` — pass.
- `pnpm test --reporter=dot` — 38 files, 361 passed, 28 skipped (DB tests need `TEST_DATABASE_URL`).
- `pnpm build` — pass (client/server/admin).
- Grind script — pass: level-1 Warrior kills a level-1 monster in 3 hits; a level-10 Warrior clears five same-level monsters in ≈19.8 s; solo level 1→10 ≈59 min / 262 kills.
- Reviewer pass — seven IMPORTANT findings were fixed: stale HUD vitals, auto-walk giving up while in range, client auto-walk cancellation, duplicate-join rollback, monster damage not marking dirty, death XP test coverage, and stat allocation during a warp.

### Acceptance criteria

| Criterion                               | Verification                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| New character grinds 1→10 on the fields | Grind simulation (above) plus room tests for kill→XP→level and persisted progression; manual run shows the same loop in the browser. |
| Combat feels punchy                     | Implemented feedback list above. Human pass: hit flash, damage numbers, crit shake, knockback, hit-stop, corpse, level-up banner.    |
| Monsters leash correctly                | AI unit tests: aggro→chase→leash→return→full heal; room test proves chasing in the live tick.                                        |
| Formula tests pass                      | `packages/shared/test/formulas.test.ts`, `combat.test.ts`.                                                                           |
| Whole phase                             | typecheck, lint, tests, build, grind script, reviewer.                                                                               |

## Known issues / deferred

- `Tab` is client-side selection only; `Space` still attacks the facing direction, and clicking is what starts auto-walk. The spec’s “Tab cycle nearby targets” works for the target frame but not as an attack key.
- The death countdown compares the server’s absolute `respawnHereAtMs` with the client clock; clock skew can delay/enable the button (the server still validates).
- Dead players can still queue input messages; the server ignores movement, but the client keeps local prediction while dead.
- Every kill enqueues a save; a large AoE can issue several DB writes. Level-up/stat saves are the important ones; batching is a Phase-4 optimisation.
- Combat/corpse events fan out from the attacker at 900 px; a client just at the monster’s interest edge may see the state change without the FX event.
- Wander is 96 px around the spawn point, not clamped to the authored `mob_zone` rectangle.
- No room-level leash test yet (AI unit tests only) and no negative tests for zero stat points / the 90 cap.
- §11 gaps: no cursor change over monsters, no centre-screen level-up banner (world text only), no shake-disable setting, hit-stop freezes monsters but not the attacker, and the “hurt animation” is a tint.
- `saveCharacters` (bulk) is implemented and tested but production autosave still uses the per-player chain.
- Audio is intentionally deferred to Phase 10.
- The real-Postgres persistence suite was skipped in this environment because `TEST_DATABASE_URL` is not set; it should be run in CI or against `jade_throne_test` before Phase 4.
