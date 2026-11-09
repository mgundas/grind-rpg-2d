# Phase 8 report — Social and progression depth

Status: implementation complete through Task 21. Phase gate Task 22 is pending.

## What was built

- **Chat:** local/shout/whisper/party/guild/system channels, cross-kingdom scrambling, profanity filtering, shout gates, client tabs with per-tab 100-line history and whisper targeting.
- **Guilds:** DB schema/service, level-30 + 500k creation transaction, 32-member cap, ranks, invites, live roster/tag updates, guild chat.
- **Friends:** DB one-way friend list, online state through the social directory, add/remove, whisper from list and context menu.
- **PvP:** Peaceful/Kingdom/Free stances, safe-zone and map-policy enforcement, party/guild friendly-fire blocking, player targeting/auto-attack, basic/skill damage integration, player death through the existing path, red Free names and player target frame.
- **Mastery:** M0–M10 data/persistence, effective-rank scaling, generic mastery tome, rank-20/cooldown validation and an atomic book-read transaction with seeded roll tests.
- **Environment:** 20-minute day/night camera tint and per-map weather (Village none, Fields leaves), with client toggles.
- **Maps:** collision-layer minimap with live entity dots and an `M` world-map view with current map and warp links.
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
pnpm verify:phase8-e2e
```

Known caveats:
- Parties remain room-local and are lost on warp (Phase 8 guild/whisper are global).
- PvP has no rewards, player statuses or lifesteal; death uses the normal XP-loss path.
- The world map is a simple two-map policy view until Phase 9.
- Weather/lighting is WebGL-filter based; a simple tint fallback is used if the filter is unavailable.
