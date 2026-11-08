# Phase 7 report — upgrades, bonuses, trading and hot-reloaded game data

Status: Phase 7 complete. The phase gate passed with the reviewer findings fixed, full DB-backed tests green and the live E2E passing.

## What was built

### Upgrades and blacksmith
- `packages/data/upgrades.json` defines the full +0 → +9 chance/gold/material table.
- Pure server planner (`apps/server/src/items/upgrade.ts`) validates ownership, level, gold, materials and Blessing Scrolls, then builds one atomic plan.
- Success advances one level. Failure destroys the item unless a Blessing Scroll is used, which downgrades one level and is consumed.
- Blacksmith protocol: preview, execute, result and typed errors, with server-authoritative range/state checks.
- Client forge window supports dragging inventory/equipment items, previewing odds/costs, a Blessing toggle and a 1.5 s hammer animation before success/failure.
- Successful +7 and above upgrades broadcast a server-wide announcement.

### Bonuses, enchant and reinforce
- `packages/data/bonuses.json` is the canonical bonus pool.
- Bonus stats feed equipment stats, combat (attack/defense/crit, attack speed, strong-vs categories), HP regen and movement speed. Resist types remain stored/displayed until PvP.
- Enchant replaces all bonuses with 1–4 unique rolls from the item type’s pool.
- Reinforce appends one new bonus and rejects items at five bonuses.
- Both are atomic: scroll and target changes commit together, invalid targets consume nothing.
- Item names use bonus-count colors; tooltips show base + upgrade + bonus lines.
- Right-clicking a bonus scroll enters targeting mode; clicking an inventory or equipped item applies it. Escape cancels.

### Trading
- Shared protocol covers invite, respond, offer, lock, accept and cancel with revisions, gold bounds and duplicate-item rejection.
- Room-local registry enforces invite TTL, one trade per character, pair identity, lock/accept ordering, offer-change resets and cancellation reasons.
- One DB transaction locks both characters and all offered item rows in UUID order, validates frozen item state, computes receiver slots, parks rows before swapping, applies both gold deltas and writes `gold_log`, `item_log` and `trade_log`.
- `trade_log` migration `0004_cute_rage.sql`.
- Client trade window offers inventory stacks and gold, supports lock/accept/cancel, shows errors and revision state.
- Admin log viewer has a Trades tab with participant, gold, item, map and trade-id filters plus expandable snapshots.

### Hot-reloaded game data
- `game_data_overrides` table and migration `0005_long_firebird.sql`.
- `packages/data/src/catalog.ts` merges base JSON with per-entry overrides and validates the whole graph through the existing Zod builders.
- Server `GameDataStore` swaps one immutable snapshot only after validation succeeds; invalid edits leave the previous version and catalog active.
- Server consumers read definitions through optional `CatalogLookup` seams (items, shops, NPCs, upgrades, scrolls, combat, skills, spawns, stats).
- Admin API: `GET/PUT/DELETE /api/admin/data/...`, `POST /api/admin/data/reload`, with before/after audit rows.
- Public `GET /api/data/catalog`.
- Admin editor supports structured item/monster fields, full JSON for nested datasets, save, revert and reload.
- Client fetches the public catalog at boot and on room connect, swapping merged definitions used by item/skill/monster UI.

## How to run

```bash
pnpm install
pnpm dev        # Postgres (Docker), server, client and admin panel
pnpm seed       # seed the admin account if needed
```

Services:
- game server: `http://localhost:2567`
- client: `http://localhost:5173`
- admin: `http://localhost:5174`
- Postgres: `localhost:5432` (`jade` / `jade_dev`)

## Tests and verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:phase7-e2e   # requires pnpm dev + pnpm seed
```

Phase-gate verification:
- `pnpm typecheck` passes.
- `pnpm lint` passes.
- `pnpm build` passes for server, client and admin.
- `TEST_DATABASE_URL=… pnpm test` passes: **106 files / 856 tests** (unit, room, DB and API suites).
- `pnpm verify:phase7-e2e` passes against a live server and Postgres: admin grants, preview/upgrade, enchant, reinforce, two-player item+gold trade, trade logs, hot reload and revert.
- DB-backed tests run with `TEST_DATABASE_URL`; they are skipped when it is unset.

## Manual acceptance checklist

1. **Upgrade chances**
   - Grant a +3 Ember Sword, Wolf Fangs and 8,000+ gold to a character.
   - Talk to Bren the Smith and drop the sword into the forge.
   - Preview must show 70% and 8,000 gold.
   - Repeat with enough materials; failures must destroy the item unless a Blessing Scroll is selected, which instead drops it one level.
   - Equip an item and upgrade it for +7; confirm the server-wide announcement.
   - Seeded planner tests include exact failure boundaries at 0.95 and 0.7 plus a seeded 85% sampling check; the remaining step chances share the same `next() < chance` rule.

2. **Enchant/reinforce**
   - Right-click an Enchant Scroll, click a weapon: existing bonuses are replaced by 1–4 rolls.
   - Right-click a Reinforce Scroll, click an item with fewer than five bonuses: one bonus is appended.
   - Try a fifth reinforce: it must fail without consuming the scroll.

3. **Trade**
   - Two characters in the same room right-click each other and choose Trade.
   - Offer an inventory item and gold, lock, accept on both sides.
   - Confirm both inventories/gold swap once, and the admin Trades tab shows the snapshots.
   - Change an offer after locking; both locks must reset.

4. **Hot reload**
   - In the admin Game Data page, edit `potion_hp_s` buyPrice to 777 and save.
   - The public catalog version changes; a newly opened shop charges 777 without restarting the server.
   - Revert the override and confirm the base price returns.

## Known issues / follow-ups

- The boot path starts listening while migrations/catalog reload finish; a join in that short window may briefly see the base catalog.
- A trade cancelled during the final DB commit still applies the committed inventory result to both runtimes, but the client may briefly receive a cancelled state before the refreshed inventory.
- The boot path starts listening while migrations/catalog reload finish; a join in that short window may briefly see the base catalog.

## Phase-gate review fixes

- Trade settlement now applies committed inventory/gold results even if a disconnect/cancel races the DB commit, and rejects a partial accepted offer.
- Stale lock/accept revisions and premature locks are rejected to the actor without cancelling the trade; the client disables Lock until an offer exists.
- Drop-table, skill, regen, shop and NPC definitions now use the catalog on the server/client where relevant.
- Client prediction consumes equipment move-speed bonuses.
- Added exact +3 chance-boundary coverage, DB failure/blessing upgrade assertions, concurrent trade execution, room stale-item cancellation, API auth/rollback checks, and fixed trade-log test isolation.
- Fixed the E2E gold expectation, added Reinforce and log checks, corrected the chance-boundary claim in this report, updated PROGRESS, and moved the admin API test to a dedicated port.
- The client catalog refresh currently updates item/skill/monster definitions; map geometry and preloaded icon assets remain build-time data, so an override that adds a brand-new icon still needs client assets.
- Existing living monsters keep their spawn-time stats; respawns pick up overrides.
- Editing an entry only affects maps that already reference its id (NPC/shop/spawn group).
