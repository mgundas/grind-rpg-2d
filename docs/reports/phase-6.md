# Phase 6 — Spirit stones, skills, parties: report

Date: 2026-11-08

## What was built

### Spirit stones
- Data-driven stone profiles in `packages/data/stones.json` (`ember_fields_stone`): 12,000 HP, wave thresholds at 80/60/40/20%, 4–6 monsters per wave, 3–5 minute respawn, 3 per zone.
- `stoneManager.ts` handles walkable placement with spacing, zone caps, damage attribution, wave thresholds, destruction and respawn. It uses a separate seeded RNG so combat rolls stay reproducible.
- Stones are a dedicated `uint32`-HP `SpiritStoneState` collection, visible beyond interest range, rendered with name/HP/pulse and shard-burst FX.
- Basic attacks and damaging skills hit stones through the shared combat pipeline. The room applies stone damage immediately per swing, spawns waves, awards contributor/party XP, rolls `spirit_stone` loot with party ownership, and schedules respawn.

### Skills
- `packages/data/skills.json` contains **48 skills** — four classes × two doctrines × six skills — with unlock levels 5–30, ranks 1–20, MP/cooldown/cast time, range/radius, damage/heal scaling, effects, FX presets and animation rows. Data tests enforce completeness and doctrine coverage.
- Skill points: one per level from level 5, derived from level minus spent ranks and backfilled on load. Ranks persist in `character_skills` (migration `0003_stiff_nitro.sql`).
- Doctrine selection is permanent, level-gated and validated against the class.
- Casting validates doctrine/rank/level/MP/cooldown/pending cast/target/range, consumes MP and cooldown at cast start, and resolves on the tick before monster AI. Movement/attack/death/warp cancel pending casts.
- Skill types: melee arc, ground area, projectile line, dash, buff and heal. Stones and monsters share one nearest-first target scan.
- Buffs/debuffs: player buffs refresh by source skill, aggregate attack/defense/crit/attack-speed/evasion, expire and clear on death/warp. Monster stun (bosses half duration), slow, poison ticks, knockback and stealth are supported. HotS tick in the skill-effects phase.
- Client: `K` skill window with doctrine choice/rank purchase/drag-to-hotbar, two-row item/skill hotbar with cooldown overlays, cast bar, buff bar, per-preset skill FX.

### Parties
- Room-local party registry: max 8, invites with expiry, accept/decline, leader promotion, loot rules, round-robin cursor, live HP/MP snapshots.
- `/invite Name`, `/leave`, click/right-click invite, party window (`P`), party frames and heal-target selection.
- Party XP: living members within 1500 px get the base kill XP plus 10% per eligible extra member. Stone XP is grouped per contributor party.
- Loot: party ownership with free-for-all or round-robin; the existing DB conditional claim remains the duplicate-item guard.
- Warp/disconnect removes the member; room dispose clears the registry.

### Other
- Field boss timer: `bossStatuses` + `bossTimer` messages on death/respawn/request, client HUD countdown.
- Admin game-data page gained read-only Skills and Stones tabs.
- DECISIONS D59–D65 record persistence, skill/stone combat, party XP/loot, buffs, boss clocks and the float32 co-location arc fix.

## How to run

```bash
pnpm install
pnpm seed
pnpm dev          # Postgres, server, client, admin
```

Useful checks:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test         # set TEST_DATABASE_URL to a disposable test DB for DB tests
pnpm verify:phase6-e2e
```

The E2E script needs the dev server and seeded admin. It registers two level-30 test characters, relocates them to the Fields stone zone through the local Postgres connection, joins them, chooses doctrines, casts a buff, forms a party, reads the boss timer, breaks a spirit stone with basic attacks and asserts both players gained XP.

## Automated verification

- `pnpm typecheck`, `pnpm lint`, `pnpm build`: pass.
- `pnpm test` against `jade_throne_test`: **86 files / 713 tests pass**.
- `pnpm verify:phase6-e2e` against a live dev server: **11/11 checks pass** (admin prep ×2, join, buff, FX, party, boss timer, stone visible, stone destroyed, both party XP gains).

## Manual acceptance walkthrough

1. **Party of two breaks a spirit stone together.** Create two accounts/characters, put them in Fields, walk to the glowing stone near the stone zone. Press `P`, invite the other by name or right-click them, accept. Both attack the stone; waves spawn at 80/60/40/20% and both clients see the shard burst.
2. **Both gain XP.** Watch both XP bars/party frames rise when the stone breaks; the E2E also asserts both `selfStats.xp` deltas.
3. **Skills look and feel distinct.** Open `K`, choose a doctrine at level 5, learn a skill, drag it to the hotbar. Cast at least one skill from each doctrine; verify arc/nova/projectile/dash/aura/heal visuals, cast bar, cooldown overlay, buff icons and damage/heal numbers.
4. **Buffs/debuffs.** Cast Iron Skin/Berserk/Hawk Eye; character stats and buff bar update. Cast Venom Strike/Ground Slam/Curse of Weakness on monsters and observe poison/stun/slow.
5. **Party UX.** Party frames show live HP/MP; click a frame to select a heal target; leader can switch loot rule; warping or leaving removes the member.
6. **Field boss timer.** The HUD shows Wolf King alive, then the 20-minute countdown after a kill.

## Known limitations

- Parties are room-local and do not survive a map warp (recorded decision).
- Skill audio is deferred to Phase 10.
- Buff/status balance is structural-first; tuning is a separate pass.
- The E2E helper relocates disposable characters with a local DB update because character creation starts in the village and the script does not walk the whole map; it is a verification helper only.
- E2E runs create accounts/logins and are subject to the server’s register/login rate limits; restart the server before repeating.
- Stone click/Tab selects and faces the stone but does not auto-walk/auto-attack it yet.
- `ownerPartyId` loot permission is runtime-only; the DB stores only the exclusive character for auditing.
