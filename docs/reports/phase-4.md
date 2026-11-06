# Phase 4 — Items and economy: phase report

Date: 2026-11-07
Plan: `docs/plans/phase-4.md`

## What was built

**Data and shared rules**
- 60 item definitions (`packages/data/items.json`) with stats, sizes, stack limits, class/level requirements, use effects, upgrade chains and icon/layer keys.
- Drop tables for all ten monsters, three shops, five town NPCs, starter kits, and data/room/test cross-reference validation.
- Shared multi-cell inventory maths (90 cells, 2 pages; 135-cell warehouse), stacking, splitting, swapping, equip/unequip, load repair and equipment aggregation.
- Seeded drop rolling with a fixed draw order (gold, then table order).

**Server**
- `items`, `item_log`, `gold_log` tables + migration `0001`; partial unique slot indexes.
- One pure-planner/one-executor item pipeline: every mutation is planned against the runtime snapshot, then committed in a single transaction that locks `accounts → characters → items`, verifies per-row expectations, parks slot changes at negative slots, and writes the item/gold ledgers.
- Load-time repair of overlaps, misplaced equipment, invalid quantities and unknown definitions, with `item_log` audit rows.
- Item/economy commands: move/split/equip/unequip/use, pickup (item + gold), shop buy/sell, warehouse deposit/withdraw, NPC dialog.
- Drops with 30 s damage-contribution ownership and 2 min despawn; items are persisted before becoming visible.
- Equipment stats feed attack, defense, crit and max HP/MP; four visual layer keys mirror into `PlayerState`.
- Starter kit (class weapon + 5 small potions + 500 gold) inside character creation.
- Inventory commands serialize per session; kick/warp/leave await the queue; return scroll avoids the chain self-deadlock and refunds on warp failure.

**Client**
- Owner-only inventory snapshots, two-page drag/drop/split inventory, equipment panel, tooltips with level/class requirements, gold in the HUD.
- Procedural equipment layers for weapon/armor/helmet/shield on own and remote characters.
- Eight-slot hotbar (1–4 / F1–F4), consumable use, auto-loot toggle.
- Ground drops with rarity beams, Alt labels, pop-in, Z/click pickup and pickup FX.
- NPC dialog, shop Buy/Sell tabs, and account warehouse window.
- `requestInventory` on session bind protects against the join-message race.

## How to run

```bash
pnpm install
pnpm dev          # Postgres + server + client + admin
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Database tests need a test database:

```bash
TEST_DATABASE_URL=postgres://.../jade_throne_test pnpm test
```

Extra checks:

```bash
pnpm verify:phase4-economy
# with the server running:
node scripts/verify-phase4-e2e.mjs
node scripts/smoke-server.mjs
```

## Acceptance criteria — manual check

1. **Kill monsters, loot items and gold**
   - Join a character, walk east to the fields, kill a Wild Dog.
   - A gold pile and a Wolf Fang beam appear; press **Z** or click them.
   - The HUD gold rises and the Fang appears in the inventory.
   - With auto-loot on, owned drops are collected automatically when close.

2. **Equip a new weapon and see it**
   - Buy a weapon from the Weaponsmith or use a dropped one; right-click it in the inventory (or drag it to another slot first if needed).
   - The attack value in the character window rises and the character sprite shows a weapon. The equipment panel shows the slot.

3. **Buy potions and use them from the hotbar**
   - Buy red potions from General Goods; drag one onto hotbar slot 1.
   - Take damage, press **1**; HP rises and the stack count decreases.
   - Drinking at full HP is rejected; a second drink inside 500 ms reports cooldown.

4. **Sell loot**
   - Open a shop, switch to **Sell**, click a Wolf Fang; gold rises by its sell price.

5. **Warehouse across characters**
   - Walk to Keeper Sol, deposit an item; log out.
   - Log in a second character of the same account, open the warehouse, withdraw the item.
   - It appears in that character's inventory; the warehouse no longer lists it.

## Verification performed

- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm build` — pass.
- `pnpm test` against `jade_throne_test` — **55 files / 513 tests passed**, including the real-Postgres transaction, concurrency, pickup, shop, warehouse and repair tests.
- `pnpm verify:phase4-economy` — pass.
- `scripts/verify-phase4-e2e.mjs` (live) — starter kit, NPC dialog, buy/sell, deposit and cross-character withdraw passed.
- `scripts/smoke-server.mjs` — server boots both rooms, DB `up`.

## Known issues / deferred

- Dragging an item out of the bag to the ground (with confirmation) is deferred; the protocol only has pickup. Recorded in `DECISIONS.md` D53.
- Shoes/bracelets/necklaces/earrings give stats but have no visible layer; weapon/armor/helmet/shield do.
- The `MapRoom.ts` file is large (~2,300 lines) despite the plan's split intent; drop/NPC/warehouse logic should move to modules in a refactor.
- Real-Postgres tests require `TEST_DATABASE_URL`; without it they skip by design.
- Accessories and upgrade levels are schema-ready but upgrades/bonuses remain Phase 7.
- The client is verified by typecheck/build and the live economy script; visual feel (drag feel, tooltip placement, equipment art, drop beams) still needs a human browser pass.
- `opencode.json` has unrelated local changes and was not touched.
