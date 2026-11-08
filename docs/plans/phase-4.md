# Phase 8 plan — Social and progression depth

Phase 8 covers guilds, friends, channel-aware chat, PvP modes and safe zones, skill books/Master levels, day/night and weather, and the minimap/world map.

## 1. What already exists

Phase 7 is complete.

Relevant foundations already implemented:

- **Chat:** room-local chat with 900 px range, 1 s cooldown, chat bubbles, 100-line client buffer and `chat_log`. Only one channel exists, and the payload has no channel or character id.
- **Party:** runtime registry with invite/accept/leave, shared XP, party loot and party frames. Parties are room-local and are lost on warp.
- **Combat:** server-authoritative monster/stone combat, arc attacks, skills, death, respawn, damage events. `CombatEntityRef` already includes player refs and the client already renders player damage, but players cannot be attacked.
- **Characters:** `characters.pvp_mode` exists with default `peaceful`, but it is not loaded into runtime, not saved through `CharacterSave`, and has no protocol or UI.
- **Skills:** ranks 1–20 persisted in `character_skills`, skill points, doctrines, 48 skills, rank validation, cooldowns, skill window. No Master levels, skill-book items, read cooldowns or book drops.
- **Trading/items:** atomic item transactions, inventory chains, scroll/book item types (`skillbook` type exists but no items), catalog-backed item definitions and drops.
- **Presence:** `SessionRegistry` tracks accounts; `AdminBus` tracks live players for the admin panel. Neither is a clean general cross-map social messaging API.
- **Maps:** only Ember Village and Ember Fields, parsed from Tiled JSON on both sides. No map policy metadata for PvP/weather/neutral status.
- **Client HUD:** React/Zustand windows, draggable `Window`, per-component hotkeys, boss timer, party frames, debug overlay. No chat tabs, guild/friends windows, minimap or world map.
- **Environment:** no day/night, lighting, weather, minimap or world-map code.
- **Persistence:** Drizzle migrations through `0005_long_firebird.sql`; `0006` will be the next migration.

### Library APIs verified

- **Phaser 4.2.1:** `camera.filters.external.addColorMatrix()` returns `Phaser.Filters.ColorMatrix` with `.colorMatrix` (`Phaser.Display.ColorMatrix`) exposing `brightness()`, `night()` and `reset()`. `this.add.particles(x, y, texture, config)` exists in the installed typings. `this.lights.enable()`, `addPointLight()`, `setAmbientColor()`, `setLighting(true)` and the `maxLights` config exist. Because current placeholder art has no normal maps, day/night should use a camera color filter plus additive point lights, not depend on normal-map lighting.
- **Colyseus 0.17:** existing decorators, `StateView`, direct `client.send` and room lifecycle patterns are sufficient. No new schema API is needed.
- **Drizzle:** the installed version supports the transaction, `.for("update")`, camelCase mapping and migration patterns already used by items/trades.

---

## 2. Task list

Each task is intended to be independently type-checked, tested and committed.

### Task 1 — Map policy and environment data

**Files**
- `packages/data/maps/policies.json`
- `packages/data/src/mapPolicies.ts`
- `packages/data/package.json`
- `packages/shared/src/environment.ts`
- tests in `packages/data/test/` and `packages/shared/test/`

**Key functions**
- `MapPolicy { mapId, label, pvpAllowed, neutral, safe, weather, connections, minimapScale }`
- `getMapPolicy(mapId)`
- `dayCycleAt(now): { phase: "dawn"|"day"|"dusk"|"night"; darkness: number }`
- `DAY_CYCLE_MS = 20 * 60 * 1000`

**Approach**
- Ember Village: safe zone, no PvP, `weather: "none"`.
- Ember Fields: PvP allowed, not neutral, `weather: "leaves"`.
- Keep policies data-driven so Phase 9 can add maps without code changes.
- Use the absolute epoch so every client computes the same day phase; no server clock message is needed.

**Tests**
- Policy validation rejects unknown map ids/weather values.
- All existing `MapId`s have policies.
- Day phases cover the full 20-minute cycle, including wrap-around.

---

### Task 2 — Chat data and shared chat contracts

**Files**
- `packages/data/chat.json`
- `packages/data/src/chatFilter.ts`
- `packages/shared/src/chat.ts`
- `packages/shared/src/protocol.ts`
- tests in `packages/data/test/chatFilter.test.ts`, `packages/shared/test/chat.test.ts`, `packages/shared/test/protocol.test.ts`

**Key functions**
- `CHAT_CHANNELS = ["local","shout","whisper","party","guild","system"]`
- `parseChatInput(text): { channel, targetName?, body }` for `/s`, `/shout`, `/w Name`, `/p`, `/g`
- `filterProfanity(text)` using the data word list
- `scrambleChatText(text, seed)` preserving spaces/punctuation and letter content
- Extended `ChatMsgPayload { from, fromCharacterId?, name, kingdom, channel, targetName?, text, sentAt }`

**Approach**
- Keep `chatMessageSchema` backward-compatible: `{ text, channel?, targetName? }`; channel defaults to local.
- Whisper requires a target name; other channels reject a target.
- Scramble server-side per recipient, not globally, so same-kingdom readers and the sender see plain text.
- Profanity filtering applies to every outbound message before delivery/logging.

**Tests**
- Slash parsing for every channel and malformed `/w`.
- Profanity replacement, case-insensitivity and no false positives on partial words.
- Scramble preserves length/spaces/punctuation and is deterministic for the same seed.
- Zod accepts valid channels and rejects whisper without a target.

---

### Task 3 — Phase 8 DB migration and schema

**Files**
- `apps/server/src/db/schema.ts`
- `apps/server/drizzle/0006_*.sql` + meta/journal (generated)
- `apps/server/test/db/socialSchema.test.ts`

**Schema**
- `guilds`: id, name, name_lower unique index, leader_character_id, created_at.
- `guild_members`: guild_id, character_id PK/unique, rank (`leader|officer|member`), joined_at; cascade guild, restrict/deny duplicate membership.
- `friends`: character_id + friend_character_id composite PK, created_at, check `character_id <> friend_character_id`.
- `character_skill_mastery`: character_id + skill_id PK, master_level 0–10, last_read_at, updated_at.
- `chat_log.channel text not null default 'local'` so existing rows remain valid.
- Optional check constraint for `characters.pvp_mode in ('peaceful','kingdom','free')`.

**Tests**
- Migration applies cleanly.
- Unique guild name is case-insensitive.
- A character can belong to only one guild.
- Self-friendship is rejected.
- Mastery level bounds are enforced.

---

### Task 4 — Global social directory and cross-map delivery

**Files**
- `apps/server/src/social/bus.ts`
- `apps/server/src/social/service.ts`
- `apps/server/src/services.ts`
- `apps/server/src/server.ts`
- `apps/server/src/rooms/MapRoom.ts`
- `apps/server/test/social/bus.test.ts`
- room fakes update

**Key interfaces**
```ts
interface SocialHandle {
  accountId: string;
  characterId: string;
  name: string;
  kingdom: string;
  mapId: string;
  roomId: string;
  send(type: string, payload: unknown): void;
  setGuildTag(name: string | null): void;
}

interface SocialDirectory {
  register(handle): void;
  unregister(characterId): void;
  get(characterId): SocialHandle | undefined;
  findByName(name): SocialHandle | undefined;
  isOnline(characterId): boolean;
  send(characterId, type, payload): boolean;
  sendMany(characterIds, type, payload): number;
}
```

**Approach**
- One process-wide bus registered in `ServerServices.social`.
- `MapRoom.onJoin` registers after the player exists; warp/leave unregister before deleting the runtime.
- `send` catches closed/disconnected clients and returns false rather than throwing.
- Friends/guild services use the bus for delivery; DB remains the source of truth.
- Whisper/friend/guild messages work across rooms; party chat stays room-local because parties are room-local in Phase 8.

**Edge cases**
- Duplicate register (duplicate join/warp race): last handle wins.
- Send to offline/closed character: silent false; caller sends an offline error to the sender.
- Room dispose/unregister must not leave ghost handles.
- Guild tag changes update the live `PlayerState` through `setGuildTag`.

**Tests**
- Register/unregister/find/send, duplicate handles.
- Closed client does not throw.
- Two-room fake bus delivers whisper to the correct handle only.

---

### Task 5 — Friends service and persistence

**Files**
- `apps/server/src/friends/service.ts`
- `apps/server/src/friends/protocol.ts` (or shared protocol section)
- `apps/server/test/db/friends.test.ts`
- `apps/server/test/friends/service.test.ts`

**Key functions**
- `listFriends(db, characterId)`
- `addFriend(db, characterId, targetCharacterId)`
- `removeFriend(db, characterId, targetCharacterId)`
- `friendState(characterId, directory): FriendsStatePayload`

**Rules**
- Add by exact character id or case-insensitive name.
- Reject self, unknown target and duplicate; duplicate add is idempotent.
- One-way friendship (no acceptance request), as the spec only asks add/remove/online/whisper.
- Online state is derived from the social directory; offline friends still appear.
- On join/leave, notify online friends with a refreshed `friendsState`.

**Tests**
- DB roundtrip, duplicate/self/unknown rejection.
- Online flag changes when the target registers/unregisters.
- Friends survive reconnect and are scoped to one character.

---

### Task 6 — Guild core service and rules

**Files**
- `apps/server/src/guilds/rules.ts`
- `apps/server/src/guilds/service.ts`
- `packages/shared/src/guild.ts`
- `apps/server/test/guilds/rules.test.ts`
- `apps/server/test/db/guilds.test.ts`

**Key functions**
- `validateGuildName(name)`
- `canInvite(rank)`, `canKick(actorRank, targetRank)`, `canPromote/demote`, `canDisband`
- `createGuild(db, { characterId, name })`
- `joinGuild`, `leaveGuild`, `kickMember`, `setRank`, `disbandGuild`, `loadGuild`

**Rules**
- Creation requires level 30 and 500,000 gold.
- Name: 3–20 characters, letters/numbers/spaces, unique case-insensitively.
- Maximum 32 members.
- Leader: all permissions. Officer: invite and kick members only. Member: leave only.
- Leader cannot leave while owning the guild; must disband or hand leadership over (Phase 8 can require disband to keep scope small).
- Guild creation is one transaction: lock character, validate level/gold, insert guild + leader membership, debit gold, write `gold_log` with a new `guild_create` reason.
- Disband removes membership rows and the guild; guild chat/state goes offline.

**Tests**
- Level/gold/name/capacity/permission failures.
- Gold is debited exactly once and rolled back on insert failure.
- Duplicate names, duplicate membership, leader/officer/member matrix.

---

### Task 7 — Guild invites, protocol and runtime integration

**Files**
- `packages/shared/src/protocol.ts`
- `apps/server/src/social/guildInvites.ts`
- `apps/server/src/rooms/MapRoom.ts` or social handler module
- `apps/server/src/guilds/service.ts`
- `apps/client/src/network/session.ts`
- tests `apps/server/test/social/guildInvites.test.ts`, room guild tests

**Messages**
- `guildCreate { name }`
- `guildInvite { characterId? | name? }`
- `guildRespond { inviteId, accept }`
- `guildLeave {}`
- `guildKick { characterId }`
- `guildSetRank { characterId, rank }`
- `guildDisband {}`
- server → `guildState`, `guildError`

**Approach**
- Guild invites are runtime-only with a 30 s TTL, similar to party invites.
- One pending guild invite per target; a newer invite replaces it.
- Accept re-validates the inviter’s rank, guild capacity and target membership inside a DB transaction.
- On success, update the guild tag/name in `PlayerState` for the room and notify online guild members with `guildState`.
- Guild creation debits gold through the existing transaction patterns and emits a `guildState` to the creator.

**Edge cases**
- Inviter leaves/demotes/disbands before accept.
- Guild fills before accept.
- Target joins another guild first.
- Accept/decline after expiry.
- Duplicate clicks and replayed invites.

---

### Task 8 — Server chat channels and routing

**Files**
- `apps/server/src/rooms/MapRoom.ts`
- `apps/server/src/chat/chatService.ts`
- `packages/shared/src/protocol.ts`
- `apps/server/src/db/schema.ts` / chat logging
- tests `apps/server/test/rooms/chatChannels.test.ts`

**Behavior**
- **Local:** current 900 px; same-kingdom readers get plain text; other-kingdom readers get scrambled text unless the reader’s map is neutral.
- **Shout:** whole room, same kingdom only, level 15+, 15 s per-sender cooldown.
- **Whisper:** target by exact name through the social directory; sender gets an echo; target gets the message even on another map; offline target returns `target_offline`.
- **Party:** only party members in the current room; reject when not in a party.
- **Guild:** validate membership; deliver to all online guild members through the social directory; reject non-members.
- **System:** existing system messages use the system channel and are never scrambled/filtered.
- Keep the global 1 s chat cooldown and existing rate limiting.
- Persist channel, sender, target and text in `chat_log`; admin Chat tab shows the channel.

**Edge cases**
- Empty/too-long text, duplicate slashes, `/w` to self, target name case differences.
- Shout before level 15 or during cooldown.
- Guild chat after leaving/disbanding.
- Reader changes map between message creation and delivery (use the current handle/map at send time).
- Scramble must not alter the sender’s own echo.
- Profanity filter before logging/delivery.

---

### Task 9 — Client chat tabs, history and whisper flow

**Files**
- `apps/client/src/ui/Chat.tsx`
- `apps/client/src/ui/chatTabs.ts`
- `apps/client/src/ui/store.ts`
- `apps/client/src/network/session.ts`
- tests `apps/client/test/chatTabs.test.ts`

**Key functions/components**
- `chatTabsReducer(state, action)` with tabs `All|Local|Shout|Party|Guild|Whisper`.
- Per-tab 100-line ring buffers; `All` receives every channel.
- Unread counts per tab.
- Input prefix parsing and tab selection; `/w Name message` sets whisper target; Enter sends; Escape blurs.
- Whisper from the friends list prefills `/w Name `.
- Bubbles only for local/shout messages, not whisper/party/guild.

**Tests**
- Per-tab caps and All aggregation.
- Unread increment/reset.
- Prefix parsing and tab routing.
- Whisper target retention/clearing.

---

### Task 10 — Client guild and friends windows

**Files**
- `apps/client/src/ui/GuildWindow.tsx`
- `apps/client/src/ui/FriendsWindow.tsx`
- `apps/client/src/ui/PlayerContextMenu.tsx`
- `apps/client/src/ui/store.ts`
- `apps/client/src/ui/App.tsx`
- `apps/client/src/network/session.ts`
- tests `apps/client/test/socialWindows.test.ts`

**Features**
- `G` opens guild: roster, ranks, online state, invite by name, kick/promote/demote, leave/disband, guild chat shortcut.
- `F` opens friends: list, online/map/level, add by name, remove, whisper.
- Right-click player menu adds: Whisper, Add friend, Invite to guild (if permitted), Attack (only when PvP-legal, later task), plus existing Trade/Party.
- Guild name/tag shown above remote players once `PlayerState.guildName` is added.
- Pure helper tests for roster sorting, permission buttons and formatting.

---

### Task 11 — Skill mastery data, persistence and effective ranks

**Files**
- `packages/data/mastery.json`
- `packages/data/src/mastery.ts`
- `packages/shared/src/skills.ts`
- `apps/server/src/characters/skillMastery.ts`
- `apps/server/src/characters/characterMappers.ts`
- `apps/server/src/skills/skillState.ts`
- `apps/server/src/rooms/playerRuntime.ts`
- tests

**Data**
```json
{
  "maxMasterLevel": 10,
  "requiredRank": 20,
  "readCooldownMs": 43200000,
  "successChanceByLevel": [0.8, 0.7, ...],
  "powerPerMasterLevel": 0.05
}
```

**Model**
- Keep normal rank 1–20 unchanged.
- Store master level separately in `character_skill_mastery`.
- `CharacterRecord.skillMastery: Record<skillId, { level, lastReadAt }>`.
- `effectiveSkillRank = rank + masterLevel` for damage/heal/buff scaling only; MP cost and cooldown continue to use normal rank.
- Extend `SkillRankView` with `masterLevel` and `nextReadAtMs`.

**Tests**
- Mastery load/persist, bounds, cooldown timestamps.
- Effective rank scaling and unaffected MP cost.
- Old characters without mastery load with level 0.

---

### Task 12 — Skill-book item, drop and pure read planner

**Files**
- `packages/data/items.json`
- `packages/data/dropTables.json`
- `packages/shared/src/items.ts` (new `skill_book` effect)
- `packages/data/src/items.ts` validation
- `apps/server/src/items/skillBook.ts`
- tests

**Approach**
- Add one generic `skillbook_mastery` item rather than 48 duplicated skill-specific books. The player chooses the rank-20 skill to master when reading.
- Add the book to the spirit-stone drop table at a low chance.
- Pure `planSkillBookRead(state, mastery, characterId, bookId, skillId, rng)`:
  - validates ownership, book type, learned rank 20, master < 10, 12 h cooldown elapsed;
  - consumes exactly the selected book instance;
  - rolls success against the data chance;
  - returns the next mastery level/cooldown and an item plan.
- Invalid target/rank/cooldown/book must not consume the book.

**Tests**
- Success/failure boundaries with scripted RNG.
- Max mastery, rank below 20, wrong class/doctrine, missing book, wrong item type.
- Failure still consumes the book and sets cooldown.
- Book drop exists in the spirit-stone table.

---

### Task 13 — Atomic skill-book transaction and room handler

**Files**
- `apps/server/src/items/skillBookTransaction.ts`
- `apps/server/src/items/service.ts`
- `apps/server/src/services.ts`
- `packages/shared/src/protocol.ts`
- `apps/server/src/rooms/MapRoom.ts`
- tests `apps/server/test/db/skillBook.test.ts`, room tests

**Approach**
- Call `@architect` before this task because it combines item consumption with mastery/cooldown persistence.
- One DB transaction locks the character, the selected book row and the mastery row, validates the frozen item/mastery state, consumes/decrements the book, upserts mastery, and returns the new `SkillState`.
- Room handler `readSkillBook { bookInstanceId, skillId }` goes through the inventory chain, rejects dead/warping/trade state, and sends `skillBookResult` plus refreshed `skillState`.
- Double-click/replay must consume once.
- A stale/moved/destroyed book cancels before any mastery change.

**Tests**
- DB success/failure, cooldown persisted, replay/stale book, book quantity decrement, rollback on failure.
- Room test with seeded RNG.
- Errors: `book_missing`, `rank_required`, `mastery_max`, `mastery_cooldown`, `book_invalid`.

---

### Task 14 — Client skill-book UX

**Files**
- `apps/client/src/ui/SkillWindow.tsx`
- `apps/client/src/ui/ItemGrid.tsx`
- `apps/client/src/ui/store.ts`
- `apps/client/src/network/session.ts`
- tests `apps/client/test/skillBook.test.ts`

**Behavior**
- Right-clicking a mastery book enters “choose a skill” mode.
- Clicking a rank-20 skill in the skill window sends `readSkillBook`.
- Show success/failure result, current M level and remaining cooldown.
- Disable skills that are ineligible or cooling down.
- Escape cancels targeting.
- Do not consume the book client-side.

---

### Task 15 — PvP rules, modes and map enforcement

**Files**
- `packages/shared/src/pvp.ts`
- `packages/shared/src/protocol.ts`
- `apps/server/src/characters/characterService.ts`
- `apps/server/src/characters/characterMappers.ts`
- `apps/server/src/rooms/playerRuntime.ts`
- `apps/server/src/rooms/state/WorldState.ts`
- `apps/server/src/rooms/MapRoom.ts`
- tests

**Key functions**
- `PVP_MODES = ["peaceful","kingdom","free"]`
- `canAttackPlayer(attacker, target, policy): boolean`
- `playerDefense(targetRuntime)` / shared PvP damage helper signature reserved for Task 16
- `setPvpMode(db, characterId, mode)` dedicated DB update.

**Rules**
- Safe maps: no player damage regardless of mode.
- Peaceful: cannot attack or be attacked by players (their mode blocks hostile targeting).
- Kingdom: only different kingdoms in PvP-allowed maps.
- Free: anyone in PvP-allowed maps; name turns red.
- Never damage self, party members or guild members in Phase 8.
- Dead/warping players are invalid targets.
- Mode is loaded on join, saved immediately on toggle, and mirrored into `PlayerState`.

**Tests**
- Full mode/kingdom/map/party/guild matrix.
- Persistence roundtrip and reconnect.
- Safe-zone enforcement in Village.

---

### Task 16 — PvP combat integration

**Files**
- `apps/server/src/rooms/combat.ts`
- `apps/server/src/skills/skillCombat.ts`
- `apps/server/src/rooms/MapRoom.ts`
- `packages/shared/src/protocol.ts`
- tests `apps/server/test/rooms/pvp.test.ts`, `apps/server/test/combat/pvp.test.ts`

**Approach**
- Call `@architect` before implementing.
- Extend basic-attack and offensive-skill candidate collection to include players only when `canAttackPlayer` passes.
- Reuse the existing hit/crit/damage formulas with the target’s equipment/stat defense; no new PvP multiplier unless explicitly decided and tested.
- Add a player-damage intent/result path; the room applies HP, `lastCombatAtMs`, death and aggro state.
- Player death uses the existing `handlePlayerDeath` path; no monster XP/loot logic runs.
- AoE/projectile/melee targeting must apply the same friendly-fire/PvP filters per target.
- No PvP rewards or item drops in Phase 8.
- Add `setPlayerTarget`/player target state separately from monster target to avoid breaking the existing `setTarget` schema.

**Edge cases**
- Target moves/dead/warps between intent and resolution.
- Same target hit twice in one tick by two attackers.
- Party/guild membership changes mid-cast.
- Mode toggled after cast begins.
- AoE hitting party members through a monster cluster.
- Death attribution, respawn, buffs cleared, trade canceled, inventory chain.
- Skill misses/crits and stone/monster hits unaffected.

**Tests**
- Mode matrix in real swings/skills.
- Safe-zone no-damage.
- PvP death and respawn.
- No friendly fire.
- Seeded hit/crit outcomes.

---

### Task 17 — Client PvP targeting, mode and name colors

**Files**
- `apps/client/src/ui/CharacterWindow.tsx` or a small HUD toggle
- `apps/client/src/ui/TargetFrame.tsx`
- `apps/client/src/ui/store.ts`
- `apps/client/src/scenes/World.ts`
- `apps/client/src/ui/PlayerContextMenu.tsx`
- tests `apps/client/test/pvp.test.ts`

**Behavior**
- Toggle Peaceful/Kingdom/Free in the character window, with an explanatory tooltip.
- Right-click a hostile player: Attack (when server rules permit), Whisper, Add friend.
- Player target frame shows name, level, guild, HP, kingdom and mode.
- Free players render red names; kingdom names keep kingdom colors.
- Targeting a player must not break monster/stone targeting; Escape clears.
- Server remains authoritative; client only sends intents.

---

### Task 18 — Day/night and weather

**Files**
- `apps/client/src/world/environment.ts`
- `apps/client/src/scenes/World.ts`
- `apps/client/src/game.ts`
- `apps/client/src/ui/store.ts`
- `apps/client/src/ui/WorldMapWindow.tsx` (toggle placement until Phase 10 settings)
- tests `apps/client/test/environment.test.ts`

**Approach**
- One `EnvironmentController` per World scene.
- Use `camera.filters.external.addColorMatrix()` and update `colorMatrix.brightness()`/`night()` from `dayCycleAt(Date.now())`.
- Optional additive `PointLight`s near the forge/NPC lamps at night; keep `maxLights` low and cull via Phaser.
- Weather uses `this.add.particles(0, 0, "fx.particle", config)` with a generated white pixel texture; leaves/rain use tints, speeds, lifespan and bounded counts.
- Weather/day-night toggles persisted in Zustand/localStorage; default on. Full settings window remains Phase 10.
- Disable/destroy filters and emitters on scene shutdown/warp.

**Tests**
- Day phase/tint curve.
- Map weather mapping.
- Weather setting toggles emitter creation/config purely.

---

### Task 19 — Minimap and world map

**Files**
- `packages/shared/src/minimap.ts`
- `apps/client/src/ui/Minimap.tsx`
- `apps/client/src/ui/WorldMapWindow.tsx`
- `apps/client/src/ui/store.ts`
- `apps/client/src/scenes/World.ts`
- `apps/client/src/scenes/Preload.ts` (generated particle/minimap texture if needed)
- tests `packages/shared/test/minimap.test.ts`, `apps/client/test/worldMap.test.ts`

**Behavior**
- When a map loads, copy its collision grid and tile dimensions into the store once.
- Minimap canvas draws solid tiles and dots for self, party members, monsters and NPCs; update dots at 4 Hz, not per Phaser frame.
- `M` opens the world map: map nodes, current-position marker, warp connections and labels from map policies. No fast travel.
- Minimap scale and click-free projection are pure helpers.
- Keep the minimap lightweight; regenerate the static background only when `mapId` changes.

**Tests**
- World→minimap projection.
- Grid image dimensions/occupied cells.
- Entity dots clamp to map bounds.
- World map node/warp layout and current-map selection.

---

### Task 20 — Admin chat channel visibility

**Files**
- `apps/server/src/admin/adminService.ts`
- `apps/admin/src/pages/LogsPage.tsx`
- `apps/admin/src/components/LogTable.tsx`
- tests `apps/server/test/db/adminRead.test.ts`

**Behavior**
- Show `channel` in the admin Chat tab and include it in `detail`.
- Optional filter by channel via existing query/search.
- No guild/friends admin pages are required by Phase 8; guild state can be inspected through existing character/DB pages.

---

### Task 21 — Phase 8 E2E, decisions and report

**Files**
- `scripts/verify-phase8-e2e.mjs`
- `package.json`
- `DECISIONS.md`
- `PROGRESS.md`
- `docs/reports/phase-8.md`

**E2E flow**
- Create two accounts/characters in different kingdoms.
- Seed one to level 30 and 500k gold; create guild; verify gold log and guild tag.
- Add friend, verify online status, whisper across maps.
- Move to Ember Fields, set PvP modes, fight; verify HP/death and safe-zone block in Village.
- Seed a rank-20 skill, grant a mastery book, read it; verify result/cooldown.
- Check chat tabs/scramble/profanity manually or via server assertions.

**Report**
- What was built, run instructions, acceptance verification, known limitations.

---

### Task 22 — Phase gate

- Run `@reviewer`, fix findings.
- Run full `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `TEST_DATABASE_URL=… pnpm test`.
- Run the live Phase 8 E2E.
- Verify every acceptance criterion manually.
- Update `PROGRESS.md` and the report; stop for human review.

---

## 3. Hard-system approaches and edge cases

### Cross-map social routing

`SocialDirectory` is process-wide and contains only online handles. All sends are best-effort and catch closed clients. DB is the authority for guild/friend membership; the bus is a delivery layer. Warp/leave unregisters the old handle before the room is disposed. Guild tag changes update both DB and the live `PlayerState`.

### Guild transactions

Guild creation is one DB transaction: lock the character row, re-check level/gold, insert guild and leader membership, debit gold, write `gold_log`. Guild join/leave/kick/promote also lock guild membership and re-check rank/capacity. Unique indexes are the final duplicate guard.

### Skill-book transaction

The book must not be consumed unless the mastery update commits. Lock character, book item row and mastery row; verify the book still exists at the same slot/quantity; consume one item; upsert mastery and cooldown in the same transaction. Failure of the roll still commits the consumed book and cooldown. Any stale/moved book or invalid skill aborts before writes.

### PvP combat

Use the existing deterministic combat RNG. Extend candidate collection rather than duplicate combat. Apply `canAttackPlayer` to every player target in basic attacks and each offensive skill shape. Keep party/guild friendly fire blocked, safe zones absolute, and dead/warping targets excluded. Player damage/death runs through the existing room death cleanup but not monster XP/loot logic.

### Chat

Server decides recipients. Local chat is per-recipient scramble-aware. Whisper/guild route through the social directory. Party chat stays room-local. All messages pass profanity filtering before delivery/logging. Per-channel cooldowns and level gates are checked server-side. The client never chooses recipients.

### Environment and minimap

Keep rendering client-side and deterministic. Use absolute time for day/night, one camera filter, bounded particle counts and no normal-map dependency. Minimap background is generated once per map; entity dots update at 4 Hz. World map uses policy connections, not a new map format.

---

## 4. Acceptance verification

| Acceptance criterion | Verification |
|---|---|
| Create a guild | DB test for level/gold/name/capacity; room/E2E create at level 30 with 500k gold; verify gold log and guild state. |
| Invite a friend | DB/friends service tests; client window; E2E add/remove and online status. |
| Whisper/shout/party/guild chat tabs | Unit tests for parser/tabs/scramble/filter; room tests for recipients/cooldowns/level gate; E2E whisper across maps. |
| Fight a player from another kingdom in a PvP map | Pure mode/map matrix; room test with two identities in Ember Fields; verify HP/death and Village safe-zone rejection. |
| Read a skill book | Unit/DB tests for success/failure, rank/cooldown/book consumption; E2E with seeded rank 20 and granted book. |
| Guild name above players | Room test asserts `PlayerState.guildName` and client name-plate rendering helper. |
| Day/night/weather | Pure cycle/weather tests; manual visual check of night tint and weather toggle. |
| Minimap/world map | Pure projection/layout tests; manual marker/warp/current-map check. |
| No regressions | Full unit/room/DB/API suites plus live Phase 8 E2E. |

---

## 5. Risks

1. **Cross-map social bus leaks/races** — duplicate handles, stale room senders, disconnect during delivery. Mitigate with unregister-before-delete, try/catch sends and fake-bus tests.
2. **Guild creation gold/duplicate exploits** — two concurrent creates or joins. Mitigate with character/guild row locks, unique indexes and one transaction.
3. **Skill-book duplication/consumption mismatch** — item transaction and mastery update separate. Mitigate with one DB transaction and stale-row verification; test replay.
4. **PvP friendly-fire/griefing** — AoE accidentally hitting party/guild or safe zones. Centralize `canAttackPlayer` and use it for every target shape; test the full matrix.
5. **PvP mode persistence** — mode loaded but not saved (current schema gap). Dedicated update + reconnect test.
6. **Chat spoofing/flooding/scrambling inconsistencies** — always derive sender identity server-side, cap channels/cooldowns, scramble per recipient and filter before logging.
7. **Phaser filter/particle performance or Canvas fallback** — keep one filter, low particle budget, settings toggle, verify in WebGL and fall back to a simple overlay if needed.
8. **Minimap store churn** — don't push entity dots every Phaser frame; update at 4 Hz and rebuild static background only on map change.
9. **Party is still room-local** — guild/whisper are global, but party chat and party persistence remain room-local. Document this as a Phase 8 limitation.
10. **Scope size** — Phase 8 contains four acceptance features plus visual systems. Keep tasks independently shippable, and do not let day/night/minimap delay the core guild/friend/PvP/skill-book acceptance flow.
