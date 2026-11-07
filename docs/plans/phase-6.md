# Phase 6 — Spirit stones, skills, parties: implementation plan

Scope: `GAME_DESIGN.md` §4.2, §6.2, §8, §9 and §12 Phase 6 only. Produced after reading `AGENTS.md`, `GAME_DESIGN.md`, `PROGRESS.md`, `DECISIONS.md`, the current code, and the installed Phaser 4.2.1 / Colyseus schema typings.

---

## 1. What already exists that Phase 6 builds on

**Data**
- Four classes and eight doctrines already exist in `packages/data/classes.json` / `src/classes.ts`, validated with Zod.
- All four classes are selectable; basic attack profiles and starting stats exist.
- `Wolf King` exists as a level-15 field boss with stats, drop table, `isBoss: true`, and a 20-minute `field_boss` spawn group.
- `map_ember_fields` already has one `stone_zone` (`fields_stones`) in generated map metadata.
- Spirit Shard / Corrupted Crystal materials and the Wolf King drop table exist.
- `skillbook` is an accepted item type, but no skillbook items exist yet.
- `ASSETS.md` already reserves the `icon.skill.*` namespace.

**Server**
- `MapRoom` has a fixed 20 Hz tick: movement → monster AI → combat → regen → respawn → spawns → ground items → warps.
- Basic attack combat is pure in `rooms/combat.ts` (`resolvePlayerSwing`, `resolveMonsterAttack`) with arc targeting, hit/crit/damage formulas, and deterministic RNG.
- Kill processing, XP (`awardKillXp`), drops (`spawnDrops`), loot ownership, death and respawn already work.
- `spawnManager` owns groups, pack aggro, boss respawn timing, and on-demand `spawnAdminMonsters`.
- `adminRuntime` already applies XP/drop rate multipliers.
- `characters` already has nullable `doctrine` and `skill_points`; `CharacterRecord` and admin detail expose them.
- Party XP is explicitly left as a Phase 6 TODO in `awardKillXp`.

**Client**
- Phaser `World` already renders players, monsters, ground items, damage numbers, corpses, level-up FX, camera shake and hit-stop.
- React overlay has a reusable `Window`, draggable inventory/character/shop/warehouse windows, target frame, HUD, 8-slot hotbar, and a Zustand bridge store.
- Network session helpers and message bindings are centralized in `network/session.ts`.
- Placeholder asset generation handles missing textures.

**Gaps**
- No `skills.json`, skills loader, skill protocol, skill ranks, cooldowns, cast state or skill FX.
- No `character_skills` table.
- No party registry/messages/UI.
- No buff/debuff runtime or icons.
- No spirit stone data, runtime, state entity, wave spawner, or client rendering.
- No boss respawn timer message/UI.
- `stoneZones` is parsed from Tiled but discarded by `mapRegistry`.
- `MonsterState.hp` is `uint16`, so stones need `uint32` or a separate schema.
- F1–F4 are already hotbar keys and F3 is also the debug key.

---

## 2. Key decisions to record in `DECISIONS.md`

1. **Parties are room-local and runtime-only.** They do not survive a map warp; warping leaves the party and notifies the remaining members. This keeps Phase 6 simple and matches “parties are runtime only” in the design.
2. **Skill ranks are 0–20.** Rank 0 means unlearned. Learning or upgrading a rank costs 1 skill point. Total points = `max(0, level - 4)`, so level 5 gives 1 point. `characters.skill_points` is a convenience/derived column, recalculated on load from level and spent ranks.
3. **Skill points are granted from level 5 onward**, and the load path backfills old characters that leveled before Phase 6.
4. **Doctrine is permanent once chosen.** It can only be chosen at level ≥5 and must be one of the character class’s two doctrines.
5. **Skill MP and cooldown are consumed when the cast starts**, not when it resolves. Moving, basic-attacking, casting another skill, dying or warping cancels a pending cast; MP/cooldown are not refunded.
6. **Skill damage is data-driven.** `damage = max(1, round(damageRoll * (attack * power(rank)) - defense * 0.7))`; magic uses `magicAttack = INT*2 + level`. Heals scale from base/per-rank plus `magicAttack * 0.5`.
7. **Buff stat model:** flat + percent modifiers to attack, defense, crit chance, attack speed and evasion. Player movement speed is not buffed in Phase 6 to avoid client-prediction drift; slow effects apply to monsters only.
8. **Stun immunity:** bosses take 50% stun duration instead of full immunity, so the effect still reads visually.
9. **Spirit stones use a dedicated `SpiritStoneState` with `uint32` HP**, are not part of monster AI, and do not block movement.
10. **Stone waves** spawn every 20% HP lost, 4–6 monsters per wave, using the existing ungrouped monster spawner. Wave monsters remain after the stone breaks.
11. **Party XP** is awarded to living party members within 1500 px of the kill; each eligible member receives the full `base * (1 + 0.10 * (eligible - 1))`. Stone XP is awarded to contributors and their nearby party members.
12. **Party loot:** free-for-all allows any party member to pick during the ownership window; round-robin assigns the owner to the next eligible member. Gold follows the same ownership rule.
13. **Skillbooks and Master levels stay in Phase 8.** Phase 6 stones drop existing materials/gear, with a spot reserved for skillbooks later.
14. **Boss timer is a message, not state:** send on join, boss death and boss respawn; the client counts down against absolute server timestamps.
15. **Hotbar remains two rows of generic slots** (keys 1–4 / F1–F4); a slot can hold an item or a skill. Old string bindings migrate to item bindings. Debug moves off F3 to F9.

---

## 3. Hard-system approaches and edge cases

### 3.1 Skill casting and resolution

**Flow**
1. Client sends `castSkill { skillId, dir?, targetMonsterId?, targetStoneId?, targetCharacterId?, x?, y? }`.
2. Server validates: known skill, class/doctrine match, rank > 0, unlock level, MP, cooldown, alive, not warping, not already casting, target/range/ground point valid.
3. On success: deduct MP, start cooldown, freeze facing, send `skillCastStart` with `completesAtMs`, store `pendingCast`.
4. On tick completion, revalidate the caster is still alive; resolve the skill even if a target died (area/projectile may hit others or whiff).
5. Send `skillCast` with `hits` (reusing `CombatHit`), heal/buff results, skill id, FX preset and origin/target positions. Damage numbers and monster deaths use existing paths.

**Targeting rules**
- `melee_aoe`: 180° frontal arc from the caster; `radiusPx` is the reach, max 12 targets.
- `area`: circle centered at a server-clamped ground point within `rangePx`.
- `projectile`: line/beam from caster to the nearest valid target or supplied point; hits targets within a narrow line width, nearest first, max 5.
- `dash`: server-side collision-safe movement up to `rangePx`; client snaps to the authoritative position after the short dash.
- `buff` / `heal`: self or a party member by `targetCharacterId`; never affect non-party players.
- Basic attacks and all damaging skills can hit both monsters and spirit stones.

**Edge cases**
- Spamming casts during cooldown, duplicate casts in one tick, unknown/foreign doctrine skills.
- Target dies or leaves before completion; target becomes invalid mid-cast.
- Movement/attack/second skill cancels the cast; no MP or cooldown refund.
- Skill kills multiple monsters in one cast; each kill is processed exactly once.
- Stone and monster hits in the same AoE; stones cannot be stunned/slowed/poisoned.
- Overkill and poison/DoT kills: attribution goes to the source session; if the source left, the fallback owner is used.
- Dash into walls/map edges; knockback into walls; clamp positions.
- AoE target caps and deterministic RNG order for tests.
- Level-up during skill resolution; admin XP multipliers apply to skill kills and stone XP.
- Party XP applies to skill kills exactly as to basic-attack kills.

### 3.2 Buffs and debuffs

**Player buffs**
- `PlayerRuntime.buffs: BuffInstance[]` with `sourceSkillId`, `name`, `iconKey`, `statModifiers`, `expiresAtMs`, `stacking`.
- Effective attack/defense/crit/attack-speed/evasion are computed at use time by a shared pure helper; base progression and inventory are never mutated.
- Refreshing the same skill replaces its old buff; different buffs stack additively with caps.
- Send `buffState` on apply, refresh, expiry, death, warp and join. Send refreshed `selfStats` so character-window values update.
- Clear buffs on death. Cooldowns persist for the room lifetime, reset on warp because the runtime is recreated.

**Monster debuffs**
- Stun: skip AI/attacks until expiry; boss duration halved.
- Slow: multiply monster movement speed while active.
- Poison: tick every 1s, credit damage to the source and use the shared damage/kill path.
- Knockback: collision-safe displacement, never through walls/edges.
- Clear debuffs when the monster dies or respawns.

**Edge cases**
- Poison tick and player attack kill the same monster in one tick.
- Buff expiry during a cast; recalculating attack speed must not corrupt the basic-attack cooldown.
- Dead/stealthed players targeted by monsters or party heals.
- Stealth breaks on dealing damage or casting an offensive skill; monsters drop target.
- Evasion reduces monster hit chance with a floor/cap.
- Buff icons for unknown skill ids fall back to a generic placeholder.

### 3.3 Party registry, XP and loot

**Registry**
- Room-local `party.ts`: parties, invites, membership, leader, loot rule, round-robin cursor.
- Max 8; invite expiry 30s; duplicate/self/offline/full invites rejected; accepting after the inviter left fails cleanly.
- Leader leaving promotes the longest-standing member; empty party is deleted.
- Warp/leave/disconnect removes the member and broadcasts; room disposal clears all parties.

**XP**
- Refactor `awardKillXp` into `awardXpForKill(killed, killerSessionId)`.
- Eligible group = killer’s party members alive in the room within 1500 px of the kill; without a party, the killer alone.
- Apply the party bonus once per eligible member; then run the existing `applyXpGain`, level-up, `selfStats`, level-up broadcast and save for each member.
- Stone XP uses contributors + their nearby party members, not every nearby player.

**Loot**
- `GroundItemRuntime` gains `ownerPartyId`; `GroundItemState` exposes it to the client if useful.
- Top damage contributor owns the drop; if in a party, the drop belongs to the party.
- Free-for-all: any member may pick during the lock.
- Round-robin: `ownerCharacterId` is the next eligible member; others are blocked until the lock expires.
- Keep the existing DB conditional claim so duplicate pickups cannot duplicate items.
- If the owner leaves, ownership falls back to the remaining party or expires.

### 3.4 Spirit stones

**Runtime and spawning**
- `stoneManager.ts` owns stone definitions, placements, HP, damage credits, wave thresholds, respawn timers and per-zone caps.
- `mapRegistry` preserves `stoneZones`; each zone spawns up to `maxPerZone` (3) stones at random walkable points with minimum spacing.
- One stone profile per zone (map id + zone id), validated against the map.
- Stones are visible from far away, so the `stones` collection is not StateView-filtered (at most 3 per zone).
- On destruction, schedule respawn in 3–5 minutes and remove the state/runtime.
- If placement fails, retry later instead of dropping the zone permanently.

**Damage and waves**
- Basic attacks and damaging skills can target stones. Stones always get hit; crits apply; defense comes from stone data.
- Track `damageBy` per stone. On each damage application, consume any crossed 20% thresholds and spawn one wave per threshold.
- Waves spawn 4–6 monsters from the stone profile around the stone, using the ungrouped spawner and `aggroMonster` for the contributors.
- If a hit skips two thresholds, spawn two waves (the design says every 20%).
- Party drops and XP use the party rules above.
- Do not let stones enter monster AI, pack aggro, respawn groups or boss logic.
- `uint32` HP avoids the 65,535 cap.

### 3.5 Combat refactor and boss timer

- Extract a single `applyDamageToMonster(ctx, sessionId, monsterId, damage, now)` helper from `resolvePlayerSwing`; it applies HP, mirrors state, credits `damageBy`, and returns a kill record.
- Add `applyDamageToStone` with the same attribution shape and wave/destruction result.
- Basic attacks, skills and poison all use these helpers, so kill/drop/XP behavior cannot diverge.
- Refactor room kill cleanup into one `handleMonsterKills` used by attacks, skills and poison ticks.
- Extend `CombatEntityRef` with `{ kind: "stone"; stoneId }` and add optional `skillId` to `CombatEventPayload`.
- Add `bossStatus(manager)` to the spawn manager, and broadcast `MSG.bossTimer` on join, boss death and boss respawn.
- Boss timer edge cases: group missing after data changes, multiple bosses later, server/client clock skew (use absolute epoch ms).

---

## 4. Task list

Each task is intended to finish, pass `pnpm typecheck`, `pnpm lint`, relevant tests and `pnpm build`, then be committed on its own.

### A. Shared foundations and data

**Task 1 — Phase 6 shared protocol and formulas**
- Files: `packages/shared/src/protocol.ts`, new `packages/shared/src/skills.ts`, `party.ts`, `stones.ts`, `packages/shared/src/formulas.ts`, `combat.ts`, `index.ts`, shared tests.
- Add `MSG`: `castSkill`, `skillCastStart`, `skillCast`, `skillCastCancel`, `skillState`, `chooseDoctrine`, `upgradeSkill`, `buffState`, `partyState`, `partyInvite`, `partyRespond`, `partyLeave`, `partySetLoot`, `partyError`, `bossTimer`, `stoneDestroyed`.
- Add Zod schemas for every client→server message.
- Add payload types: skill state/cooldowns, skill cast/start/cancel, buff views, party snapshot/invite/error, boss timer, stone destroyed.
- Extend `SelfStatsPayload` with `doctrine` and `skillPoints`; extend `CombatEntityRef` with stones.
- Add shared formulas: `magicAttackOf`, `skillDamage`, `skillHeal`, `skillPointsForLevel`, `partyXpMultiplier`, buff aggregation helpers.
- Add pure circle/line target helpers to `combat.ts`.
- Tests: schema accept/reject, formula values, geometry, party bonus, skill points.

**Task 2 — Skills data loader + Warrior skills**
- Files: `packages/data/skills.json`, `packages/data/src/skills.ts`, `packages/data/package.json`, `packages/data/test/skills.test.ts`, `packages/data/src/index.ts` if needed.
- Zod schema for all skill fields; exports `SKILLS`, `getSkill`, `hasSkill`, `skillsForDoctrine`.
- Add Warrior `blade` and `iron_body` (12 skills: 6 each).
- Tests: ids unique, class/doctrine valid, ranks, unlock levels, damage/heal/effect consistency.

**Task 3 — Assassin skills**
- Files: `skills.json`, `skills.test.ts`.
- Add `shadow` and `hawk` (12 skills).
- Tests: per-doctrine count and unlock ordering.

**Task 4 — Hexblade skills**
- Files: `skills.json`, `skills.test.ts`.
- Add `cursed_steel` and `dark_arts` (12 skills).

**Task 5 — Mystic skills and completeness**
- Files: `skills.json`, `skills.test.ts`.
- Add `dragon` and `grace` (12 skills).
- Add final completeness test: exactly 6 skills per doctrine, 48 total, every class doctrine covered.

**Task 6 — Spirit stone data and drop table**
- Files: `packages/data/stones.json`, `packages/data/src/stones.ts`, `packages/data/dropTables.json`, `packages/data/package.json`, tests.
- Schema: zone id, map id, name, level, HP (12k-range), defense, XP, gold, drop table, wave thresholds/count/monster pool, max per zone, respawn 3–5 min, sprite key/color.
- Add a `spirit_stone` drop table with existing materials/gear; no skillbooks yet.
- Tests: valid zones, wave counts 4–6, thresholds strictly descending, drop table and monsters exist, respawn bounds.

**Task 7 — Preserve stone zones in map assets**
- Files: `apps/server/src/maps/mapRegistry.ts`, `packages/data/test/maps.test.ts` if needed, server map tests.
- Add `stoneZones` to `MapAssets` and copy from `extractMapObjects`; validate at least one zone on fields.
- Tests: fields map exposes `fields_stones` with the expected bounds.

**Task 8 — Admin read-only Skill/Stone tabs**
- Files: `apps/admin/src/pages/GameDataPage.tsx`.
- Add `SKILLS` and `STONES` tabs with search/detail, same read-only pattern as items/monsters.
- No editing; Phase 7 still owns hot reload.

### B. Persistence and progression

**Task 9 — `character_skills` table and service**
- Files: `apps/server/src/db/schema.ts`, new migration `drizzle/0003_*.sql`, new `apps/server/src/characters/characterSkills.ts`, `apps/server/test/db/characterSkills.test.ts`.
- Table: `character_id`, `skill_id`, `rank`, `updated_at`, primary key `(character_id, skill_id)`, cascade delete.
- Functions: `loadSkillRanks(db, characterId)`, `saveSkillRank(db, characterId, skillId, rank)`, `saveDoctrineAndPoints(db, ...)` as needed.
- Tests: create/read/upsert, cascade, transaction behavior.

**Task 10 — Doctrine, skill points and skills in progression/save**
- Files: `characterService.ts`, `characterMappers.ts`, `characters/progression.ts`, `characters/spawn.ts`, `MapRoom.ts` save calls, `test/rooms/fakes.ts`, DB tests.
- Extend `CharacterRecord` with `skills: Record<string, number>` (loaded with the character).
- Add `doctrine`, `skillPoints` to `PlayerProgression`; derive unspent points from level and spent ranks; backfill legacy characters.
- Add `doctrine`, `skillPoints` to `CharacterSave`; update single and bulk save SQL.
- Extend `SelfStatsPayload` sending with doctrine/skillPoints.
- Tests: save/load roundtrip, level-5 backfill, multi-level-up points, admin level changes clamp safely.

**Task 11 — Doctrine selection and skill upgrades**
- Files: new `apps/server/src/skills/skillState.ts`, `MapRoom.ts`, `characterSkills.ts`, room tests.
- Messages: `chooseDoctrine`, `upgradeSkill`; server validates class/doctrine, level ≥5, rank 0–20, points available.
- Send full `skillState` after join, doctrine choice, upgrade and level-up; persist doctrine and rank transactionally before mutating runtime.
- Errors: `doctrine_locked`, `doctrine_invalid`, `skill_locked`, `skill_maxed`, `no_skill_points`.
- Tests: invalid class/doctrine, level gate, point exhaustion, rank cap, reconnect persistence.

### C. Party system

**Task 12 — Pure party registry**
- Files: new `apps/server/src/rooms/party.ts`, `apps/server/test/rooms/party.test.ts`.
- Functions: create party, invite/accept/decline, leave, remove character, promote leader, set loot rule, rotate round-robin, snapshot.
- Tests: max 8, expiry, duplicate invites, self-invite, leader promotion, empty disband, duplicate accept, loot rotation.

**Task 13 — Room party integration**
- Files: `MapRoom.ts`, `network` protocol wiring already in Task 1, room tests.
- Handlers: `partyInvite`, `partyRespond`, `partyLeave`, `partySetLoot`, `/invite Name` and `/leave` chat commands.
- Broadcast `partyState` on membership/leader/loot changes and every 500ms for HP/MP/level; remove members on leave/warp/disconnect.
- Tests: invite/accept, frames snapshot, leader change, warp cleanup, full party rejection.

**Task 14 — Party XP and loot rules**
- Files: `MapRoom.ts` (`awardKillXp`, `spawnDrops`, `pickupDrop`), `party.ts`, `WorldState`/`GroundItemRuntime`, room tests.
- Refactor `awardKillXp` to `awardXpForKill`; add `awardXpToGroup`.
- Apply 10% per eligible extra member within 1500 px.
- Add `ownerPartyId`; free-for-all vs round-robin pickup checks.
- Tests: two-member party both gain XP; far/dead member excluded; bonus math; party loot pickup; non-party still blocked.

### D. Spirit stones and boss timer

**Task 15 — Pure stone manager**
- Files: new `apps/server/src/rooms/stoneManager.ts`, `test/rooms/stoneManager.test.ts`.
- Functions: `createStoneManager`, `spawnInitialStones`, `spawnStone`, `damageStone`, `tickStoneRespawns`, `stoneStatus`, placement helper.
- Deterministic seeded placement and respawn; thresholds/waves result.
- Tests: max 3 per zone, spacing/walkability, 20% thresholds, overkill, respawn timer, no duplicate spawns.

**Task 16 — Combat damage refactor and stone targets**
- Files: `apps/server/src/rooms/combat.ts`, `test/rooms/combat.test.ts`.
- Add `applyDamageToMonster`, stone candidate selection, `StoneHit`/`KilledStone`, aggro/damage attribution.
- Ensure basic attacks can hit stones and monsters; max-target behavior.
- Tests: exact existing combat behavior remains; stone hits; no monsters affected by stone-only logic.

**Task 17 — Room spirit stone integration**
- Files: `WorldState.ts` (`SpiritStoneState`, `stones`), `MapRoom.ts`, `stoneManager.ts`, room tests.
- Create/spawn stones on room creation; tick respawns; remove on destroy.
- On threshold: spawn 4–6 wave monsters around the stone and aggro contributors.
- On destruction: award stone XP to contributors/party, roll `spirit_stone` drops with party ownership, broadcast `stoneDestroyed`.
- Extend `setTarget` to accept stone ids and auto-walk/attack stones.
- Tests: stone appears in state, splits damage, waves spawn, drops/XP on destruction, respawn after timer.

**Task 18 — Field boss timer server**
- Files: `spawnManager.ts`, `MapRoom.ts`, `test/rooms/spawnManager.test.ts`.
- Add `bossStatus`/`groupStatus`; broadcast `bossTimer` on join, death and respawn.
- Tests: alive state, death sets 20-minute respawn, respawn broadcasts alive.

**Task 19 — Client stone rendering, targeting and boss timer**
- Files: `World.ts`, `monsterRegistry`/new stone registry, `store.ts`, `TargetFrame.tsx`, new `BossTimer.tsx`, `App.tsx`, `session.ts`, asset manifest/preload.
- Render stones with pulsing placeholder text/particles, HP bars, hit flashes and shard burst.
- Click/select stones; target frame shows stone HP; Tab includes stones.
- Boss timer component with absolute countdown; system chat on boss spawn/death.
- Tests: pure timer formatting/state reducer if extracted.

### E. Skills and buffs

**Task 20 — Pure skill validation and cast state**
- Files: new `apps/server/src/skills/skillRuntime.ts`, `test/skills/skillRuntime.test.ts`.
- Functions: `validateSkillCast`, `beginSkillCast`, `cancelCast`, `processPendingCast`, `skillCooldownState`.
- Validation matrix from §3.1.
- Tests: every rejection code, MP/cooldown consumption, movement cancellation, duplicate casts.

**Task 21 — Buff/status model**
- Files: new `apps/server/src/skills/effects.ts`, `test/skills/effects.test.ts`.
- Pure functions: apply/refresh buff, expire, aggregate attack/defense/crit/attack-speed/evasion, monster stun/slow/poison/knockback timers.
- Tests: stacking, refresh, cap, boss stun half duration, expiry, poison ticks.

**Task 22 — Pure skill combat resolution**
- Files: new `apps/server/src/skills/skillCombat.ts`, `test/skills/skillCombat.test.ts`.
- Resolve each type: melee arc, area circle, projectile line, dash, heal, buff.
- Apply damage to monsters and stones, effects, lifesteal, heal/HoT, party targets.
- Tests: range, target caps, friend/foe filtering, stone hits, heal amounts, every effect type, deterministic RNG.

**Task 23 — Room skill casting and buff integration**
- Files: `MapRoom.ts`, `playerRuntime.ts` (cast/buff fields), `WorldState` if needed, room tests.
- Add `castSkill` handler, tick cast processing before monster intents, skill FX broadcasts, kill cleanup reuse, buff selfStats refresh/expiry, stealth targeting exclusion, attack-speed cooldown.
- Tests: cast a skill, damage/death/drop/XP, cooldown rejection, buff icon state, stun/slow monster, party heal.

### F. Client UI and feel

**Task 24 — Client network and store fields**
- Files: `network/session.ts`, `ui/store.ts`.
- Add handlers/senders for skill state, cast/start/cancel, buffs, party state/invite/errors, boss timer, stone destroyed.
- Store: doctrine, skillPoints, skill ranks/cooldowns, buffs, cast state, party snapshot/invites, boss timer, cursor world point, party heal target.
- Request skill state on join.

**Task 25 — Skill window and doctrine selection**
- Files: new `ui/SkillWindow.tsx`, `App.tsx`, `store.ts`, `network/session.ts`.
- `K` opens; shows doctrine cards below level 5 / unselected; six skills with rank, unlock, MP/CD, current/next description, Learn/+ buttons.
- Drag skill to hotbar; send upgrade/doctrine messages.
- Tests: pure display/rank helpers if extracted.

**Task 26 — Two-row hotbar and skill casting**
- Files: `ui/Hotbar.tsx`, `hotbarStorage.ts`, `World.ts` (cursor world), `store.ts`, tests.
- New binding union `{kind:"item"|"skill", id}`; migrate old string arrays to item bindings.
- Two rows of four, keys 1–4 / F1–F4; F3 debug moves to F9.
- Trigger skill with current target (`monster`, `stone`, party target, or cursor ground/dash direction).
- Cooldown overlays from `skillState`.
- Tests: migration, binding lookup, trigger payload selection.

**Task 27 — Skill FX, cast bar and buff bar**
- Files: `World.ts`, new `ui/CastBar.tsx`, `ui/BuffBar.tsx`, `App.tsx`, asset manifest/placeholders.
- Add FX presets: slash arc, spin/nova ring, projectile orb + trail, ground circle, dash trail, aura, heal glow, shard burst.
- Use Phaser 4.2.1 `scene.add.particles(x, y, texture, config)` with `emitting:false` + `explode`; cache generated textures and cap concurrent emitters.
- Camera shake/hit-stop for big skills; damage numbers already reused.
- Buff icons with countdown; cast bar from server start/cancel messages.
- Tests: pure FX preset selection and timer formatting.

**Task 28 — Party window, frames and invite-by-click**
- Files: new `ui/PartyWindow.tsx`, `ui/PartyFrames.tsx`, `World.ts`, `App.tsx`, `store.ts`.
- `P` opens party window; roster with HP/MP, level, leader marker; loot-rule selector for leader; invite input and leave button.
- Side frames with live HP/MP; clicking a frame sets heal target.
- Right-click remote player opens a small context menu with “Invite to party”; invite message carries character id.
- Tests: pure party snapshot reducers/presentation helpers.

### G. Verification and gate

**Task 29 — Phase 6 E2E, decisions and report**
- Files: new `scripts/verify-phase6-e2e.mjs`, `package.json`, `DECISIONS.md`, `PROGRESS.md`, `docs/reports/phase-6.md`.
- Script: two logged-in clients, level them via admin API, choose doctrines, learn/cast skills, form a party, walk to a stone, break it together, assert both XP gains, assert boss timer, buff state and skill FX messages.
- Record all decisions from §2.
- Add `verify:phase6-e2e` package script.

**Task 30 — Phase gate**
- Call `@reviewer` once; fix findings; run full checks; manual browser acceptance; write final report; stop for human approval before Phase 7.

**Subagent usage**
- Call `@architect` once before Task 16/22 for the skill/stone damage pipeline, and once before Task 14 for party XP/loot, because these are combat/inventory-adjacent hard systems. Follow the returned plan.
- `@reviewer` only at Task 30.

---

## 5. Skill data design

All skills are rank 1–20, with unlock levels spread across 5/8/12/16/22/30. `iconKey` uses `icon.skill.*`; `fx` selects the client preset; `color` comes from the doctrine/class.

| Doctrine | Skills (unlock — type — effect) |
|---|---|
| **Warrior / Blade** | Whirlwind 5 — melee AoE — physical; Charge 8 — dash — knockback; Sword Burst 12 — melee arc — heavy physical; Berserk 16 — buff — attack + attack speed; Ground Slam 22 — area — stun; Blade Aura 30 — buff — attack |
| **Warrior / Iron Body** | Shield Bash 5 — melee — short stun; Iron Skin 8 — buff — defense; War Cry 12 — party buff — defense; Ground Breaker 16 — area — knockback; Fortress 22 — buff — defense/evasion; Unbreakable 30 — self heal + defense |
| **Assassin / Shadow** | Shadow Step 5 — dash — reposition; Ambush 8 — melee burst; Venom Strike 12 — melee — poison; Fan of Knives 16 — area — physical; Stealth 22 — buff — monsters ignore until attack; Evasion 30 — buff — evasion/crit |
| **Assassin / Hawk** | Piercing Shot 5 — projectile — physical; Quick Step 8 — dash; Multishot 12 — projectile line — multiple targets; Hawk Eye 16 — buff — crit; Arrow Rain 22 — area — physical; Wind Walk 30 — buff — attack speed |
| **Hexblade / Cursed Steel** | Cursed Slash 5 — melee arc; Blood Price 8 — buff — attack with one-time HP cost; Hex Brand 12 — melee — poison; Soul Reap 16 — melee AoE — lifesteal; Dark Pact 22 — buff — attack/attack speed; Doom Cleave 30 — area — knockback |
| **Hexblade / Dark Arts** | Shadow Bolt 5 — projectile — magic; Curse of Weakness 8 — projectile — slow; Dark Nova 12 — area — magic; Drain Life 16 — projectile — magic + self heal; Chains of Shadow 22 — area — stun; Abyssal Rift 30 — area — high magic |
| **Mystic / Dragon** | Dragon Pulse 5 — projectile — magic; Flame Breath 8 — melee cone — magic; Meteor 12 — area — magic; Dragon Fear 16 — area — slow; Thunder Crash 22 — area — stun; Dragon Wrath 30 — area — high magic |
| **Mystic / Grace** | Healing Light 5 — heal — self/ally; Blessing 8 — party buff — attack/defense; Purify 12 — heal + cleanse; Sanctuary 16 — area HoT; Spirit Shield 22 — party buff — defense; Divine Grace 30 — large party heal + defense buff |

The exact values live in `skills.json`; tests enforce structure, not final balance. Balance tuning is a separate pass after the mechanics work.

---

## 6. Tests to write

**Shared**
- Protocol schemas accept valid casts/party/doctrine messages and reject malformed ids, directions, coordinates and target combinations.
- Magic attack, skill damage, heal, party bonus, skill-point formulas.
- Circle/line target selection, range boundaries and max targets.
- Skill state/buff/party snapshot serialization.

**Data**
- 48 skills, 6 per doctrine, unique ids, valid class/doctrine, unlock levels, rank caps, valid effect/damage/heal combinations.
- Every stone zone profile references a real map, monster, drop table; wave thresholds/counts valid; respawn bounds.
- Map `stone_zone` survives into `MapAssets`.

**DB**
- Migration creates `character_skills`; load/upsert/cascade.
- Doctrine, skill points and ranks survive save/reload.
- Legacy characters get correct backfilled points; level changes do not produce negative points.

**Pure server**
- Skill validation, cooldowns, cast cancellation, MP.
- Every skill type and effect: arc, area, projectile, dash, heal, buff, stun, slow, poison, knockback, lifesteal, stealth, evasion.
- Buff stacking/refresh/expiry; boss stun reduction.
- Party invite/accept/leave/leader promotion/full/expiry/loot rotation.
- Party XP eligibility and bonus, stone XP eligibility.
- Stone placement, thresholds, overkill waves, respawn, max per zone.
- Unified damage/kill attribution for basic attacks, skills and poison.

**Room integration**
- Cast a skill and observe state/XP/drops/cooldown.
- Buff appears, expires, refreshes selfStats, and is cleared on death.
- Party of two kills a monster and both gain XP; far member does not.
- Party loot allows free-for-all/round-robin correctly; non-party pickup still blocked.
- Spirit stone takes damage from two players, spawns waves at thresholds, breaks, drops and awards XP to both, respawns.
- Boss timer broadcasts on join/death/respawn.

**Client pure helpers**
- Hotbar legacy migration, item/skill binding resolution, cooldown formatting.
- Party snapshot reducer/frame formatting, boss timer formatting, FX preset selection.

**E2E**
- Two clients, party formation, doctrine/skill learning, skill cast, stone destruction, both XP gains, boss timer and buff messages.

---

## 7. Acceptance verification

GAME_DESIGN Phase 6 acceptance:

1. **A party of two can break a spirit stone together**
   - Automated room test: two clients in the same party damage one stone; damage attribution and destruction are shared.
   - Live E2E: two clients walk to `fields_stones`, attack/cast until `stoneDestroyed`, verify the stone disappears and respawn is scheduled.
   - Manual: both players see the stone HP, wave monsters and shard burst.

2. **Both get XP**
   - Room test asserts each member’s `selfStats.xp`/level delta is non-zero and matches the party bonus formula.
   - E2E captures both snapshots before/after destruction.
   - Manual: party frames and XP bars rise for both.

3. **Skills look and feel distinct per class**
   - Data test proves each class/doctrine has six unique skills with distinct FX presets.
   - Room tests prove each skill type applies its intended damage/effect.
   - Manual visual checklist: cast at least one skill from each of the eight doctrines; verify arc/nova/projectile/dash/heal/buff shapes, colors, particles, shake and damage numbers.

Additional Phase 6 feature checks:

- **Skill window:** level 5 choice, six skills, ranks, points, hotbar drag.
- **Buffs/debuffs:** icons, timers, attack/defense changes, monster stun/slow/poison.
- **Party frames:** live HP/MP, invite/accept/leave, leader loot rule, warp cleanup.
- **Field boss timer:** Wolf King alive/dead state and 20-minute countdown.
- **Spirit stone waves:** one wave every 20% HP, 4–6 monsters.
- **Regression:** full existing suite plus `pnpm verify:phase5-e2e` still passes.

---

## 8. Risks and how to avoid them

1. **Phase scope is very large (48 skills, stones, parties, buffs, UI).** Mitigation: split skill data by class, keep all combat math data-driven, and close systems incrementally with tests before starting the client UI.
2. **Refactoring basic-attack combat could break existing behavior.** Mitigation: extract a single damage helper first, keep the existing swing outcome shape, and run the full 595-test suite after every combat change.
3. **Spirit stone HP overflow.** Mitigation: dedicated `SpiritStoneState` with `uint32`, not `MonsterState.uint16`.
4. **Party XP double-awarding or missing XP for the killer.** Mitigation: one `awardXpForKill` authority, pure eligibility helper, deterministic room tests with two clients, explicit fallback for no party.
5. **Party loot races or item duplication.** Mitigation: keep the existing DB conditional claim as the final authority; party ownership is only a runtime permission layer.
6. **Skill cast state diverges from the client.** Mitigation: server owns start/completion/cancel messages and cooldowns; client cast bar is display-only; movement/attack cancellation is explicit.
7. **Buff stacking creates unbounded power.** Mitigation: same-skill refresh, additive caps, effective-stat helper, and selfStats refresh tests.
8. **Poison/DoT kills bypass drops or XP.** Mitigation: all damage paths call the same damage/kill helper and room kill cleanup.
9. **Skill points lost or duplicated on reconnect.** Mitigation: derive total points from level, persist ranks, backfill on load, and write ranks transactionally before mutating runtime.
10. **Stones block placement or spawn inside walls.** Mitigation: walkable placement with minimum spacing and retry; stones do not contribute to collision, so they cannot trap players.
11. **Client performance from many particle effects.** Mitigation: cached textures, short-lived emitters, concurrent FX cap, and reuse the existing damage-number/FX patterns.
12. **F1–F4/F3 key conflicts and old hotbar saves.** Mitigation: migrate old bindings to item bindings, move debug to F9, and test the migration helper.
13. **Room-local party limitation surprises players.** Mitigation: record the decision, show a clear message on warp/leave, and keep cross-map parties as a Phase 8/10 extension.
14. **Tests become slow or flaky with two clients and timers.** Mitigation: deterministic RNG, injectable stone placement/test seams, short combat tuning like existing room tests, and pure tests for most logic.

---

## 9. Recommended execution order

Start with Tasks 1–7 (contracts, skills data, stone data, map zones), then persistence 8–11, party 12–14, stones/boss 15–19, skills/buffs 20–23, client 24–28, and finish with E2E, review and the phase gate.
