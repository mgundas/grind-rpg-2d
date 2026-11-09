# Phase 8 report — Social and progression depth

Status: complete. Phase gate Task 22 verified on 2026-11-09.

## What was built

- **Chat:** local/shout/whisper/party/guild/system channels, cross-kingdom scrambling, profanity filtering, shout gates, client tabs with per-tab 100-line history and whisper targeting. Whisper and guild chat route through the process-wide social directory, so they work across rooms; party chat stays room-local.
- **Guilds:** DB schema/service, level-30 + 500k creation transaction, 32-member cap, leader/officer/member ranks, invites (process-wide so cross-room invites work), live roster/tag updates and guild chat. Leaving or being kicked re-reads the roster from the database.
- **Friends:** DB one-way friend list, online state through the social directory, add/remove, whisper from list and context menu.
- **PvP:** Peaceful/Kingdom/Free stances, safe-zone and map-policy enforcement, party/guild friendly-fire blocking, player targeting/auto-attack, basic/skill damage integration, player death through the existing path, red Free names and player target frame. PvP deaths skip the PvE XP-loss rule; there are no PvP rewards, drops, lifesteal or player-applied statuses.
- **Mastery:** M0–M10 data/persistence, effective-rank scaling, generic mastery tome, rank-20/cooldown validation and an atomic book-read transaction with seeded roll tests.
- **Environment:** 20-minute day/night camera tint and per-map weather (Village none, Fields leaves), with client toggles.
- **Maps:** collision-layer minimap with live entity dots and an `M` world-map view with current map and warp links. The static minimap background is cached per map and only the entity dots redraw.
- **Admin:** chat log channel column in the Chat tab.

## How to run

```bash
pnpm install
pnpm dev
pnpm seed
pnpm verify:phase8-e2e   # needs the live server + Postgres
```

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm build
TEST_DATABASE_URL=... pnpm test
E2E_SERVER_URL=... pnpm verify:phase8-e2e
```

Gate results (2026-11-09):

- `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.
- Full suite against `jade_throne_test`: **133 files / 968 tests pass**.
- Live Phase 8 E2E passes **13 checks**: mastery book grant, guild creation/invite, guild leave before PvP, friend add, cross-map whisper, same-room PvP, players in range, book load/read, mastery cooldown, PvP attack delivery and damage.
- Reviewer findings were fixed before the gate: guild invites moved to a process-wide registry (cross-room accept regression test added), PvP death XP exemption with room-level no-XP/no-loot assertion, guild/party/invisible/stealth friendly-fire coverage including an AoE mixed-crowd case, slash/body chat canonicalisation, guild-name minimum, roster reload after leave/kick, in-trade and moved-book skill-book guards, cached minimap background and updated admin kick/editor expectations.

## Manual acceptance

1. **Guild:** at level 30 with 500k gold, create a guild from the guild window. Invite a character in another map; accept from that character. Check the tag above both name-plates and the live roster.
2. **Friends:** add a character, confirm the online dot, whisper from the friends list, then remove the friend.
3. **Chat:** type local, `/shout`, `/whisper Name`, `/p` and `/g` messages. Check per-tab history and that cross-kingdom local chat is scrambled in Fields.
4. **PvP:** in Ember Fields set two characters from different kingdoms to Free (or Kingdom) and attack each other. Confirm damage, name colour, target frame and death. Repeat in Ember Village and confirm attacks are rejected. Confirm party/guild members cannot damage each other.
5. **Skill book:** seed a rank-20 skill, grant `skillbook_mastery`, read it, confirm the mastery level/effective rank, cooldown and that the book is consumed. Reading while dead or warping must fail without consuming.
6. **Day/night/weather:** toggle the settings and confirm the night tint and Fields leaves. The 20-minute cycle is visible over time.
7. **Minimap/world map:** press `M`, confirm the current map, warp links and that minimap dots move at 4 Hz while the collision background does not flicker.

## Known caveats

- Parties remain room-local and are lost on warp (Phase 8 guild/whisper are global).
- PvP has no rewards, player statuses or lifesteal; a PvP death revives through the normal death/respawn flow without PvE XP loss.
- The world map is a simple two-map policy view until Phase 9.
- Weather/lighting is WebGL-filter based; a simple tint fallback is used if the filter is unavailable.
