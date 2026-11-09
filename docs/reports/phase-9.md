# Phase 9 — The wider world (report)

## What was built

- **Nine maps** from GAME_DESIGN.md §3.1, all generated deterministically by
  `packages/data/src/generate-maps.ts` and committed as Tiled JSON:
  Ember/Gale/Tide Villages, Ember/Gale/Tide Highlands (`map_ember_fields` is the
  Ember Highlands, kept for save compatibility — D77), Valley of Echoes,
  Corrupted Forest and the Spider Cave dungeon. Policies carry labels,
  PvP/neutral/safe, weather, a dungeon flag and the bidirectional travel graph
  (D78). Every map is registered on the server and loaded by the client.
- **Travel:** a `teleporter` NPC kind (Waykeeper) in every town/highland map,
  paid travel to connected maps (destination-priced, gold logged as
  `teleport`), a teleporter dialog with costs, and a real 3×3 world-map layout.
- **Channels CH1–CH4:** one room per (map, channel) via
  `.filterBy(["channel"])` + metadata, channel-aware auth, saves, warp tokens
  and reservations, a character-select picker and an in-game HUD switcher.
  Matchmaking peeks at warp tokens so a full room cannot burn them; a full
  channel reports `channel_full` instead of overfilling (D79).
- **Content to level 60:** 33 monsters (including six boss groups), 93 items
  (tier 4–6 gear, grand potions, void/ancient materials), shop stock in all
  three towns, and seven spirit stones across the highlands/valley/forest.
- **Parties survive travel:** the registry moved to `ServerServices.parties`;
  warps detach and the target room rebinds the session, so cross-map party
  frames work and the dungeon can keep a party together (D80).
- **Spider Cave instances:** `DungeonRoom` filters by `partyId`, requires a
  matching party at auth, caps at 8 players, persists the forest fallback
  instead of a dungeon position, and disposes when empty.
- **Mounts:** a reusable Jade Wolf Whistle (`summon_mount` effect) toggles
  `mounted`, adds the shared 1.5× speed multiplier, syncs to `PlayerState`,
  renders a placeholder mount, and dismounts on attack/death/warp or when the
  whistle leaves the inventory (D81).
- **Admin:** live rooms show their channel.
- **Tooling:** `verify:phase9-grind` (1→60 balance bands + boss groups) and
  `verify:phase9-e2e` (live register → create → teleport → channel switch),
  plus committed-map equality and stone-linkage tests.

## How to run

```
pnpm install
pnpm dev            # Postgres, server, client, admin
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Targeted checks:

```
node --import tsx scripts/verify-phase9-grind.mjs
node scripts/verify-phase9-e2e.mjs      # with the dev server running
node scripts/smoke-server.mjs
```

## Acceptance criteria — manual verification

1. **Home village → neutral maps.** Create a character in any kingdom, talk to
   the Waykeeper (north of the plaza), pick your Highlands (50 gold; the fee is
   in the dialog), then walk east through the valley gate into the Valley of
   Echoes (200 gold by teleporter, or the map-edge warp). Continue east into
   the Corrupted Forest (400 gold / warp). Return warps are on each map's edge
   and the Waykeeper always lists only connected maps.
2. **Channels.** At character select, choose CH1–CH4 before Play (the choice is
   remembered per character). In game, use the HUD `CH` dropdown to switch; the
   screen fades, the character keeps its position, and a second client on CH1
   cannot see the CH2 character (admin Live Rooms shows one row per channel).
3. **Dungeon with a party.** Form a party of two, walk to the Corrupted Forest
   east gate, and enter the Spider Cave together (solo entry is refused). Fight
   through the chambers, kill the Spider Queen, and leave through the entrance
   warp; both members keep the party, share XP and party loot rules, and death
   inside sends the dead player back to the forest.

## Verification performed (2026-11-09)

- `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.
- Full suite: **116 files / 869 tests pass**, 21 files / 127 tests skipped
  (DB suites without `TEST_DATABASE_URL`).
- Real-Postgres suites with `TEST_DATABASE_URL` pointing at
  `jade_throne_test`: **18 files / 107 tests pass**.
- `node --import tsx scripts/verify-phase9-grind.mjs`: all bands, 1→60 grind
  (≈21.8 h unspent-stat estimate) and six boss groups pass.
- `node scripts/verify-phase9-e2e.mjs` against a live server: 11/11 checks pass
  (travel to the highlands, channel preserved, CH2 switch).
- `node scripts/smoke-server.mjs` boots all nine rooms with the database up.
- `@reviewer` findings fixed before this report: dungeon auth now requires the
  server-issued `partyId`; a failed channel switch no longer persists the new
  channel; mounts are bound to their inventory instance; dungeon positions are
  never saved; dead Gale/Tide characters respawn in their own village; warp
  tokens are pruned on every check; dungeon cap is 8; committed maps and stone
  zones are pinned by tests.

## Known issues / deferred

- Cross-map party members do not contribute to XP or loot (the existing
  1500 px rule) and party chat remains room-local; only guild/whisper chat is
  process-wide (D80). A member whose target join never completes has no
  detached-member TTL yet.
- A teleport fee is refunded when the reservation fails, but not if the client
  abandons after a successful reservation and is disconnected by the leave
  timeout.
- All nine Tiled maps load eagerly in `Preload`, which pushes the client
  bundle to ~3.4 MB; lazy per-map tilemap loading is the intended follow-up.
- The live E2E covers travel and channel switching; the dungeon party flow is
  covered by `dungeon.test.ts` but not yet by the live script.
- Real art is still placeholder; `ASSETS.md` lists the new map/monster/mount
  keys.
