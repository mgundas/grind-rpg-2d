# Phase 7 — Upgrades, bonuses, trading: implementation plan

Scope: `GAME_DESIGN.md` §7.4–7.5, §9, §10.5 and §12 Phase 7. Produced after reading `AGENTS.md`, `GAME_DESIGN.md`, `PROGRESS.md`, `DECISIONS.md`, the item/transaction/UI code, and the installed package typings.

---

## 1. What already exists

**Items and inventory**
- `packages/data/items.json` already has `upgradeStep` per item, expanded to absolute `upgradeChain` arrays of length 10 (`+0…+9`) in `packages/data/src/items.ts`.
- `items.upgrade_level` and `items.bonuses jsonb` already exist in PostgreSQL and in `ItemInstanceDto`/`ItemStack`.
- Admin grants already accept upgrade level and bonuses.
- Inventory/equipment/warehouse planning is pure (`items/planning.ts`) and commits through one locked transaction (`applyItemTransaction`).
- `item_log`, `gold_log`, `admin_log` exist.
- Blessing/Enchant/Reinforce/Return scroll item definitions already exist; the first three have no mechanics or acquisition path.

**Blacksmith**
- The blacksmith NPC data and Tiled map object exist.
- `NpcDialogKind` already includes `blacksmith`, but `interactNpc` sends a dialog with no client branch and there is no upgrade flow.

**Bonuses**
- `ItemBonus { type, value }` is stored and displayed in the admin tooltip, but **not aggregated into stats**.
- `effectiveItemStats`/`sumEquipmentStats` only use base stats + upgrade chain.
- Item names currently use rarity color, not the spec’s bonus-count color.

**Critical pipeline gaps**
1. `RowState`/`UpdateChange` cannot represent `upgradeLevel` or `bonuses` changes.
2. `diffInventory` ignores them.
3. `applyItemTransaction` never writes them on update.
4. The room fake has the same limitation.
5. No trade protocol, registry, transaction, UI, or trade log.
6. No admin game-data override table, API, editor, or hot-reload catalog.
7. No upgrade/bonus data tables, planners, messages, or tests.

---

## 2. Key design decisions to record

1. **Upgrade table lives in `packages/data/upgrades.json`** with exact chance/gold/material rows. No balance values in code.
2. **Material mapping:** +3→4 = 1 Wolf Fang, +4→5 = 2 Wolf Fangs, +5→6 = 3 Wolf Fangs, +6→7 = 2 Spirit Shards, +7→8 = 4 Spirit Shards, +8→9 = 1 Corrupted Crystal. Recorded because the spec says “tier material” ambiguously.
3. **Upgrades are single-owner atomic plans**: gold, materials, scroll consumption, item upgrade/destroy/downgrade all commit together.
4. **Failure destroys the item unless a Blessing Scroll is selected**; with a scroll, the item drops one level and the scroll is consumed. Materials/gold are always consumed.
5. **Upgrade rolls use the server’s crypto RNG**; tests inject a seeded/scripted RNG. The client never supplies roll data.
6. **The server resolves immediately; the client plays the 1.5 s suspense animation before revealing the result.** This keeps the server authoritative without withholding state.
7. **Server-wide +7 announcements** happen on successful upgrades from +6→+7 and above, using the existing announcement bus.
8. **Bonus name color is by bonus count:** 0 = rarity/default white, 1–2 = blue, 3–4 = purple, 5 = gold. Rarity stays on borders/beams.
9. **Trade is same-room only** in Phase 7; it uses the room-local runtime map. Cross-map trading is deferred.
10. **Only inventory items can be traded** in Phase 7. Equipped/warehouse items must be unequipped/withdrawn first.
11. **Trade state machine:** invite → accepted → offers → both Lock → both Accept → one transaction. Any offer change resets both locks and accepts.
12. **Trade is one database transaction** locking both characters in UUID order, then item rows in UUID order; item ownership changes, both gold deltas, item/gold logs, and a `trade_log` row commit together.
13. **Hot reload is server-side and admin-driven:** base JSON remains the default; overrides live in `game_data_overrides`, are validated with the existing Zod schemas, and swap atomically on save/reload.
14. **Client game data for edited definitions** is refreshed from a public catalog endpoint on boot/map join; otherwise tooltips can disagree with server behavior. If this proves too costly, the fallback is a documented “reload client after editing” limitation.

---

## 3. Hard-system approaches and edge cases

### 3.1 Upgrade flow

**Preview**
- Client sends `requestUpgradePreview { instanceId }`.
- Server validates the item is in inventory or equipment, near the blacksmith, not dead/warping, and trade-free.
- Returns current level, next level, chance, gold cost, material list, whether the player has each material, blessing-scroll availability, and whether the item is maxed.

**Execution**
- Client sends `upgradeItem { instanceId, useBlessing }`.
- Validation: near blacksmith, inventory chain idle, item still present, +9 cap, enough gold/materials, blessing present if requested.
- Pure planner builds one `ItemPlan`:
  - remove gold,
  - remove material stacks (split quantities if needed),
  - remove blessing scroll if selected,
  - on success: set `upgradeLevel + 1`,
  - on failure without blessing: delete the item row,
  - on failure with blessing: set `upgradeLevel = max(0, level - 1)`.
- The transaction writes upgrade level and logs:
  - `item_log.action`: `upgrade_success` / `upgrade_failure` / `upgrade_blessing_saved`
  - `gold_log.reason`: `upgrade`
- After commit, refresh the runtime inventory/equipment, recompute stats, send inventory + selfStats.
- On +7 or higher success, broadcast a server-wide announcement.

**Edge cases**
- Item destroyed → remove from the client and stats.
- Blessing selected but absent/race → reject before rolling.
- Equipment item upgrade → refresh visual/stat layers and selfStats.
- Last material stack consumed → remove the row.
- Gold cap/negative gold guard.
- Duplicate/spam upgrade clicks → `inventoryChain` serializes; add a short upgrade cooldown if needed.
- Disconnect during the animation → result is already committed; reconnect sees the final item.
- The item is moved/traded between preview and execute → execute reloads and rejects stale.
- A blessing scroll cannot be used from the warehouse or equipment.
- No materials requirement for +0..+3.
- Roll uses cumulative `next() < chance`; tests script exact values.

### 3.2 Bonuses

**Data**
- `bonuses.json`: canonical bonus types, labels, ranges, and eligible item types.
- Initial pool: max HP, max MP, attack, defense, crit chance, attack speed, move speed, HP regen, strong vs monsters/animals/spirits, resist sword/dagger/bow/magic.
- Shared `BONUS_TYPES` union used by data, server and client.

**Aggregation**
- `effectiveItemStats(definition, upgradeLevel, bonuses)` adds upgrade-chain stats and bonus stats.
- `sumEquipmentStats` sums bonuses from all equipped items.
- Apply max HP/MP to progression; attack/defense/crit to combat and selfStats; attack speed to basic attack cooldown; move speed to the movement step; HP regen to regen.
- `strong vs monsters/animals/spirits` applies only to matching monster types; resist types remain stored/displayed until PvP in Phase 8 (record this).
- Bonuses do not affect skill MP/cooldown unless explicitly an attack/crit/attack-speed stat.

**Scrolls**
- **Enchant:** requires item with equipment type, removes all existing bonuses, rolls 1–4 from the eligible pool. Always consumes the scroll on success.
- **Reinforce:** requires item with fewer than 5 bonuses, appends 1 from the pool, consumes the scroll.
- Both are atomic with the target item update; invalid target consumes nothing.
- Duplicate bonus types are allowed only if the data permits stacking; otherwise reroll/choose without replacement.
- After a bonus change, equipped item stats and `selfStats` refresh immediately.

**Name colors/tooltips**
- `itemNameColor(bonusCount)` in shared.
- Tooltips show base + upgrade + bonus lines, requirement red, sell price.
- Inventory, equipment, shop, warehouse, hotbar and admin tooltip use the helper while retaining rarity borders/beams.

### 3.3 Trading

**Protocol**
- `tradeInvite { characterId }`
- `tradeRespond { tradeId, accept }`
- `tradeOffer { tradeId, revision, instanceIds, gold }` (whole inventory stacks; gold absolute offered amount)
- `tradeLock { tradeId, revision, locked }`
- `tradeAccept { tradeId, revision }`
- `tradeCancel { tradeId }`
- Server → `tradeInvite`, `tradeState { tradeId, revision, phase, you, other, locked/accept flags, error? }`, `tradeError`.

**Registry**
- One active trade per character; invite TTL 30 s; same room and within interaction range (or 1500 px).
- Pair key sorted by character ID, so both sides share one record.
- Any offer change increments revision, clears both locks and accepts.
- Lock only when both sides have valid offers; accept only when both locked.
- Cancel on decline, leave, warp, death, disconnect, timeout, or inventory mutation of an offered item.
- Reject self-trade, same account, dead/warping, inventory closed.

**Transaction**
- Validate both sides still online and offered items still owned/at the same location/slot/quantity/upgrade/bonuses.
- Lock both character rows in sorted UUID order; lock all offered item rows in sorted UUID order.
- Detect duplicate instance IDs and offering the same item twice.
- Compute free target slots using shared inventory placement helpers after removing outgoing items.
- Update each row’s `ownerAccountId`, `ownerCharacterId`, `slot`, keeping UUID, upgrade and bonuses.
- Apply both gold deltas in one transaction, write two `gold_log` rows with reason `trade` and a shared `tradeId`.
- Write `item_log` rows for both sides with `action = "trade"` and `detail.tradeId`/counterpart.
- Insert one `trade_log` row with both participants, offered item snapshot, gold, and result.
- Update both room runtimes/snapshots only after commit; send a new `tradeState` and inventory snapshot to both.
- On any failure: no rows move, no gold changes, both sides get an error and the trade cancels.

**Edge cases**
- Both players trade gold; validate each delta against the frozen balance at lock/commit.
- Inventory becomes full after outgoing items are removed → reject; nothing moves.
- Item destroyed/equipped/moved while trade open → revision mismatch or lock revalidation cancels.
- Disconnect of one side → cancel; no ghost locks.
- Same item offered by both sides → reject.
- A player cannot be in two trades or trade during warp/death.
- Concurrent pickup/trade/upgrade on the same item → DB row locks + ownership verification; one wins, the other gets `stale`.

### 3.4 Admin game-data hot reload

**Storage**
- `game_data_overrides`: `dataset`, `entry_id`, `payload jsonb`, `updated_by`, `updated_at`, PK `(dataset, entry_id)`.
- Base JSON remains the default; overrides are merged on boot.
- `GameDataStore` exposes typed getters for items, monsters, drop tables, shops, spawn groups, NPCs, skills, stones, upgrades, bonuses.
- Each reload parses/validates the whole merged dataset with existing schemas; invalid data is rejected and the previous version stays active.
- A monotonically increasing `version` is exposed.

**Server consumers**
- Replace direct static `getItem`/`getNpc`/etc. imports in server code with catalog getters. This is the main refactor; do it before the editor so every action sees overrides.
- Rooms/catalog reads per action; existing entities may keep old data. Deleted definitions fall back safely or reload refuses to delete an entry used by an active room.
- Client fetches a public merged catalog (or at least item/upgrade/bonus definitions) on boot and after a reload/version change; otherwise tooltips can disagree.

**Admin**
- `GET /api/admin/data/:dataset`, `PUT /api/admin/data/:dataset/:id`, `DELETE`, `POST /api/admin/data/reload`.
- Every mutation writes `admin_log` with before/after payload.
- Admin editor: per-dataset forms/JSON editor with schema validation errors, save/revert, reload button.
- Edits are live for new drops/shops/spawns/items; invalid entries cannot break running rooms.

---

## 4. Task list

Each task should typecheck, run its tests and commit independently.

### A. Data, shared rules, persistence

**Task 1 — Upgrade and bonus data**
- Files: `packages/data/upgrades.json`, `packages/data/bonuses.json`, `src/upgrades.ts`, `src/bonuses.ts`, `packages/data/package.json`, tests.
- Exact upgrade rows 0→9 (chance/gold/materials/max level).
- Bonus pool with type, label, min/max, item types, stacking rules.
- Validate cross-references (materials exist, bonus types unique, ranges valid).
- Add Reinforce Scroll acquisition (shop or drop) and test it is obtainable.

**Task 2 — Shared bonus/upgrade contracts**
- Files: `packages/shared/src/upgrades.ts`, `bonuses.ts`, `items.ts`, `constants.ts`, `index.ts`, tests.
- `UpgradeStep`, `UpgradeResult`, `BonusType`, `BONUS_TYPES`, `BonusRoll`, `itemNameColor(bonusCount)`.
- Extend `effectiveItemStats`/`sumEquipmentStats` to include bonuses; add aggregation tests.
- Keep rarity colors for frames/beams and add bonus-count colors for names.

**Task 3 — Persist upgrade/bonus row changes**
- Files: `items/itemChanges.ts`, `itemTransactions.ts`, `planning.ts` (`diffInventory`), `itemRepository`/mappers if needed, test fake.
- Add `upgradeLevel`/`bonuses` to `RowState`/`UpdateChange`; compare in `diffInventory`; verify in `verifyChange`; write in transaction; update the fake executor.
- Add `upgrade`/`trade` to `GoldReason`.
- Tests: update +5/bonuses roundtrip, stale mismatch, item log detail.

**Task 4 — Bonus stats in gameplay**
- Files: `items/equipment.ts`, `shared/formulas` if needed, `selfStats.ts`, `combat.ts`, regen/movement call sites.
- Apply attack/defense/crit/max HP/MP/attack speed/move speed/regen/strong-vs/animal/spirit.
- Tests: equipped bonus changes selfStats, basic attack, monster damage, movement/regen; resist types remain display-only.

**Task 5 — Bonus-aware tooltips and names**
- Files: `ItemTooltip.tsx`, `ItemGrid`, `EquipmentPanel`, `ShopWindow`, `WarehouseWindow`, `Hotbar`, admin tooltip/GameDataPage.
- Use `itemNameColor`, show base/upgrade/bonus stats, bonus count.
- Tests: pure color/format helpers.

### B. Upgrades

**Task 6 — Pure upgrade planner and roll**
- Files: `apps/server/src/items/upgrade.ts`, tests.
- `getUpgradeStep`, `upgradeCost`, `canUpgrade`, `planUpgrade`.
- Handles gold/materials/scroll, success, destroy, blessing downgrade, +9 cap, inventory/equipment target, seeded RNG.
- Tests: exact chances with scripted RNG, material consumption, failure destroy, blessing downgrade/consumption, max level.

**Task 7 — Blacksmith protocol and preview**
- Files: shared protocol, room handlers, client network helper.
- `requestUpgradePreview`, `upgradeItem`, `upgradeResult`, `blacksmithError`; Zod schemas.
- Server preview validates blacksmith range and returns chances/costs/materials/blessing availability.
- Tests: schema, preview in/out of range, invalid item.

**Task 8 — Server upgrade execution**
- Files: `MapRoom.ts`, `items/upgrade.ts`, DB tests/room tests.
- Serialize through inventory chain, consume atomically, refresh equip/stats, logs, +7 announcement.
- Tests: DB +5 persistence; room upgrade success/failure; equipment refresh; materials/gold consumed once; +7 broadcast.

**Task 9 — Client blacksmith window**
- Files: `NpcDialog.tsx`, new `BlacksmithWindow.tsx`, store/network.
- Drag inventory/equipment item into window; preview chance/cost/materials; blessing checkbox; 1.5 s hammer animation then success flash/failure shatter.
- Client block if not enough materials/gold.
- Tests: pure preview formatting and state reducer.

### C. Bonuses

**Task 10 — Pure enchant/reinforce planners**
- Files: `apps/server/src/items/bonusScrolls.ts`, tests.
- Roll 1–4 bonuses (enchant) or append one (reinforce), max 5, eligible pool filtering, seeded RNG.
- Tests: distribution boundaries, replace/append, max5 rejection, no target consumption on invalid.

**Task 11 — Scroll application flow**
- Files: shared protocol, `MapRoom.ts`, planning/transaction.
- `applyBonusScroll { scrollInstanceId, itemInstanceId }`; validate item type/scroll, consume atomically, update bonuses, refresh equip/stats/logs.
- Tests: DB/room apply, scroll consumed once, invalid target unchanged.

**Task 12 — Client scroll UX**
- Files: inventory/ItemGrid context action, store “apply scroll to item” mode, tooltips.
- Right-click/use scroll selects it, then click target item to apply; cancel on Escape; show bonus result.
- Tests: mode reducer/cancel.

### D. Trading

**Task 13 — Trade protocol and errors**
- Files: shared protocol, tests.
- Messages, Zod schemas, `TradeStatePayload`, `TradeErrorCode`, revisions.
- Tests: offer/lock/accept validation, invalid instance ids/gold.

**Task 14 — Pure trade registry**
- Files: `apps/server/src/rooms/trade.ts`, tests.
- Invite TTL, pair state, offers, revision, lock/accept, cancel, cancel on offer change, one trade per character.
- Tests: full state machine, duplicate/self/offline, revision reset, expiry.

**Task 15 — Trade transaction and log**
- Files: new `trade_log` migration/schema, `items/tradeTransaction.ts`, service wiring, DB tests.
- Lock both characters/items deterministically, swap ownership, free-slot placement, both gold deltas, item/gold/trade logs.
- Tests: successful item+gold swap, full inventory rejection, stale item, concurrent trade, no duplication, logs.

**Task 16 — Room trade integration**
- Files: `MapRoom.ts`, trade registry, room tests.
- Invite/respond/offer/lock/accept/cancel, range, cleanup on leave/warp/death, both runtime snapshots.
- Tests: two-client item+gold trade, lock reset on offer change, disconnect cancel, stale item cancellation.

**Task 17 — Client trade window and context menu**
- Files: new `TradeWindow.tsx`, store, network, `World.ts` right-click menu, inventory drag.
- Offer inventory stacks, gold input, lock/accept, revision handling, cancel.
- Tests: pure trade state/revision reducer, window formatting.

**Task 18 — Admin trade log**
- Files: server route/service, admin `api.ts`, `LogsPage`/`LogTable`, migration if needed.
- Trade tab with item/gold/participants/tradeId filter/detail.
- Tests: query/filter and empty state.

### E. Admin game-data hot reload

**Task 19 — Override table and catalog store**
- Files: migration `0005`, schema, new `server/src/gameData/store.ts`, tests.
- Merge base data + overrides, validate whole datasets, version, safe fallback.
- Tests: valid override, invalid override rejected, version bump.

**Task 20 — Refactor server consumers to catalog**
- Files: `items/planning.ts`, `MapRoom.ts`, item mappers, admin mutations, shops/drops/spawns.
- Replace static data getters with catalog getters; keep tests passing.
- Tests: catalog-backed buy/drop/spawn uses override.

**Task 21 — Admin data API**
- Files: admin routes/service, Zod schemas, tests.
- GET/PUT/DELETE datasets, reload, audit before/after, 400 on invalid.
- Tests: auth/role, valid save, invalid save rollback, reload version.

**Task 22 — Admin game-data editor**
- Files: `GameDataPage.tsx`, forms/JSON editor, API client, reload button.
- Structured item/monster forms and validated JSON for nested datasets; revert override.
- Tests: pure form validation/mapping.

**Task 23 — Client catalog refresh**
- Files: public data endpoint or admin catalog API, client data access layer, version check on boot/reconnect.
- Use merged item/skill/monster data where client displays definitions; refetch after reload.
- Tests: catalog mapping and fallback.

### F. Verification

**Task 24 — Phase 7 E2E, decisions and report**
- Files: `scripts/verify-phase7-e2e.mjs`, `package.json`, `DECISIONS.md`, `PROGRESS.md`, `docs/reports/phase-7.md`.
- Live flow: admin grants gold/materials; upgrade attempts; apply enchant/reinforce; two-client trade item+gold; verify inventories/logs; edit an item via admin, verify server behavior without restart; revert.
- Seeded unit tests prove the exact +4 chance outcomes.

**Task 25 — Phase gate**
- `@reviewer`, fix findings, full typecheck/lint/build/test, live E2E, manual acceptance, report, stop.

---

## 5. Tests to write

**Data**
- Upgrade table covers 0→9 exactly, chances/gold/materials valid, material item ids exist, no gaps.
- Bonus pool types valid, min≤max, item-type eligibility, no duplicate types where stacking is disallowed.
- Reinforce Scroll is obtainable.

**Shared**
- Bonus aggregation for every stat type; name color by bonus count; upgrade effective stats; sum equipment.
- Upgrade/bonus/trade protocol schemas accept/reject correctly.

**Server pure**
- Upgrade rolls: success at boundary, failure, destroy, blessing downgrade, scroll/material/gold consumption, +9.
- Enchant 1–4, reinforce +1, max5, invalid target.
- Trade state machine: invite/accept/offer/lock/accept, offer change resets, duplicate/self/expiry/cancel.
- Trade transaction: ownership swap, slots, gold, full inventory, stale item, concurrent same item, no duplication.
- Catalog merge/validation/version, invalid override fallback.

**DB**
- Upgrade level/bonuses persist through the item transaction.
- Trade transaction moves rows and gold exactly once, writes item/gold/trade logs.
- Override CRUD and reload persistence.
- Upgrade material/gold atomicity on failure.

**Room**
- Blacksmith preview/execute, equipment refresh, +7 announcement.
- Bonus scroll apply and invalid target.
- Two-client trade item+gold, lock reset, cancel on warp/disconnect, stale item.
- Catalog override affects new drops/spawns.

**Client**
- Tooltip name color/bonus lines, blacksmith preview reducer, scroll mode, trade revision reducer, catalog fetch/fallback.

**E2E**
- Live upgrade, scroll, trade, admin log and hot-reload flow.

---

## 6. Acceptance verification

1. **Upgrade an item to +4 with real failure chances (seeded tests)**
   - Unit tests script RNG values across +0→+4, including success/failure and blessing behavior.
   - DB/room tests assert upgrade level, material/gold consumption and item destruction/downgrade.
   - Manual/E2E: grant materials/gold, upgrade live, observe the suspense animation and result.
2. **Add bonuses**
   - Unit tests prove enchant replacement (1–4) and reinforce append (max5).
   - DB/room tests prove scroll consumption and persisted bonuses.
   - Client tooltip/name color and selfStats reflect bonuses.
3. **Trade an item and gold safely**
   - DB test executes a two-owner trade and verifies both inventories/gold and one transaction.
   - Two-client room/E2E test offers an item + gold, locks/accepts, verifies both sides and cancellation paths.
   - Concurrency/stale tests prove no item duplication or gold loss.
4. **Every action appears in admin logs**
   - Upgrade/enchant/reinforce write item/gold logs.
   - Trade writes item/gold/trade logs with `tradeId`.
   - Admin trade tab and item/gold filters show them.
5. **Admin data editing hot reload**
   - Save an item change in the admin editor; a new shop/drop/action uses it without restart.
   - Invalid data is rejected and the old version remains.
   - Delete override/reload restores base data.

---

## 7. Risks and mitigations

1. **The item transaction pipeline cannot persist upgrade/bonus edits today.** Fix `RowState`/`UpdateChange`/`diffInventory`/`verifyChange` before any upgrade or scroll task.
2. **Trade duplication.** Use one transaction with deterministic character/item lock order, ownership verification, no row copying, and a unique `tradeId` in logs.
3. **Trade state races.** Revision numbers, inventory-chain serialization, cancel-on-change, revalidation at accept/commit.
4. **Upgrade RNG determinism.** Inject `RandomSource`; crypto in production, seeded only in tests; never trust the client.
5. **Consumable atomicity.** One plan commits gold, materials, scrolls, item level/destruction together; invalid actions consume nothing.
6. **Bonus/client disagreement.** Add shared bonus aggregation and catalog refresh; tests compare selfStats and tooltips.
7. **Hot reload can break running rooms.** Validate the whole merged dataset, swap atomically, keep the previous version on failure, fallback for deleted ids.
8. **Static imports block hot reload.** Refactor consumers to catalog getters before building the editor.
9. **The phase is large.** Split upgrades, bonuses, trade and hot reload into separate commits; keep pure cores separate from the room.
10. **Same-room-only trade is a limitation.** Record it; cross-map trade needs a global service.
11. **No PvP yet.** Resist weapon/magic bonuses are stored/displayed but inert until Phase 8.
12. **Stat changes can affect existing tests.** Update item/equipment/selfStats assertions and run the full suite after each pipeline change.
13. **Upgrade/trade UI complexity.** Keep the server state machine authoritative and use pure reducers for client windows.

### API check

Checked the installed packages relevant to this plan: Drizzle `jsonb`, `.for("update")`, `Tx` transaction callbacks and the existing `ItemPlan`/`ItemChange` executor; Colyseus schema/message patterns already used by Phase 5/6; Phaser 4.2.1 tween/particle APIs for blacksmith/FX animations. No new library is required. Hot reload uses PostgreSQL/Drizzle jsonb storage and an admin-triggered catalog swap, not filesystem watchers.
