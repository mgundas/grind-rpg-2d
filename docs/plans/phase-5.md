# Phase 5 — Admin panel: implementation plan

Scope: `GAME_DESIGN.md` §10.5 and §12 Phase 5 only. Hot-reloadable game-data editing remains Phase 7; Phase 5 includes a read-only data viewer. Plan produced after reading the current admin/server code, auth/roles, room integration points, migrations and installed Colyseus/Express typings.

---

## 1. What already exists and what this phase builds on

**Already present**

- **Admin app shell:** `apps/admin` is Vite 8 + React 19 + Tailwind v4, port 5174, with only a visual-only login form. No API client, auth, routing, proxy or pages.
- **Admin identity:** `accounts.role` is `player | gm | admin`; `scripts/seed.ts` creates the admin account and `GameMaster` character from `SEED_ADMIN_*`.
- **Auth/RBAC groundwork:** access/refresh tokens, `requireAuth`, `AccountPublic.role`, login/refresh/logout, account bans (`banned_until`, `ban_reason`) checked in login, refresh, join auth and `requireAuth`.
- **Session control:** `SessionRegistry.kickAccount`/`kickCharacter`, close code 4100, one live session per account.
- **Audit/data foundations:** `item_log` and `gold_log` already accept `admin`; items/inventory/warehouse services and the pure item planner/executor exist; `characters` has level/gold/stats/position.
- **Room systems:** `MapRoom` registration points, `PlayerRuntime`, item command queue, `applyItemPlan`, spawn manager, persistence/save chains, private chat handler.
- **Tests:** shared/data Vitest, room tests with `@colyseus/testing` and fakes, real-Postgres DB tests, HTTP route tests.

**Missing / must be added**

- No `admin_log`, `announcements`, `chat_log` tables; no admin routes or role guard; no online-player enumeration; no cross-room live bus.
- No admin mutations (ban/unban/kick/give item/edit character/teleport/spawn), no announcements, no rate multipliers, no shutdown scheduler.
- `@colyseus/monitor` is **not installed**; no `/colyseus` mount; no admin cookie for the iframe.
- No admin item-give/remove planner, no GM slash commands, no admin chat logging.
- Admin app has no proxy, so `:5174 → :2567` requests are cross-origin today.
- No client-side announcement banner or `admin`/`ban` kick reasons.

**Verified library facts**

- `@colyseus/monitor@0.17.9` (`legacy-0.17`) is the matching line; README shows `app.use("/colyseus", authMiddleware, monitor())`, peer `@colyseus/core 0.17.x`, Express `>=4.16`. Inspect its installed `.d.ts` after install before coding.
- Colyseus 0.17 exposes `matchMaker.query`, `getLocalRoomById`, `Server.gracefullyShutdown(exit?, err?)` and `Room.onBeforeShutdown`.
- Vite 8 supports `server.proxy` including `ws: true`; Express 5 has `res.cookie`/`clearCookie`.
- There is no `forbidden` API error code yet, and no admin/system message type.

---

## 2. Numbered task list

Each task ends with `pnpm typecheck`, targeted tests, `PROGRESS.md` tick and a commit.

### Task 1 — Shared admin contracts, protocol and error codes
**Files:** `packages/shared/src/admin.ts`, `packages/shared/src/protocol.ts`, `packages/shared/src/auth.ts`, `apps/server/src/errors.ts`, `packages/shared/test/admin.test.ts`.

**Key contents**
- Zod request schemas: `adminBanSchema` (duration minutes or null = permanent + reason), `adminGiveItemSchema` (definition, quantity, upgrade 0–9, ≤5 bonuses), `adminUpdateCharacterSchema` (level/gold/stats/position), `adminRatesSchema`, `adminSpawnSchema`, `adminShutdownSchema`, `adminAnnouncementSchema`.
- Response types: dashboard, player search row/detail, online player, item/log rows, announcement, server status.
- `ApiErrorCode` gains `forbidden` (403) and `conflict` (409); `ERROR_STATUS` updated.
- `MSG.announcement` + `AnnouncementPayload`; `SessionKickReason` gains `admin` and `ban`.
- Tests: accept/reject boundaries, "all optional update needs at least one field", item/upgrade limits.

### Task 2 — Database schema + migration
**Files:** `apps/server/src/db/schema.ts`, generated `drizzle/0002_*.sql` + meta.

**Tables**
- `admin_log`: id, actorAccountId, action, targetAccountId, targetCharacterId, detail jsonb, ip, createdAt; indexes by actor/target/time.
- `announcements`: id, message, kind (`immediate|recurring|shutdown`), intervalMs nullable, active, createdBy, createdAt, lastSentAt, expiresAt.
- `chat_log`: id, characterId, name, kingdom, mapId, text, createdAt; index by time/character.
- Types exported. `item_log`/`gold_log` reused.

### Task 3 — Role guard and monitor cookie auth
**Files:** `apps/server/src/http/requireRole.ts`, `apps/server/src/http/adminCookie.ts`, `apps/server/src/routes/auth.ts`, tests `apps/server/test/http/adminCookie.test.ts`.

**Key functions**
- `requireRole("gm", "admin")` after `requireAuth`; returns 403 `forbidden`.
- `setAdminCookie(res, accessToken, ttl)` / `clearAdminCookie(res)`: HttpOnly, SameSite=Lax, Secure in production, path `/`.
- Login and refresh set the cookie only when the account role is gm/admin; logout clears it.
- `requireAdminCookie({authDeps})` verifies the cookie token, account token version, role and ban state; used by `/colyseus`.
- Unit tests for cookie set/clear and role middleware with injected accounts.

### Task 4 — Admin read service
**Files:** `apps/server/src/admin/adminService.ts`, `apps/server/src/admin/adminLog.ts`, tests `apps/server/test/db/adminRead.test.ts`.

**Key functions**
- `dashboard(db, bus)`: online total/by map/channel, uptime/memory/CPU, registrations today, total gold, online history.
- `searchAccountsAndCharacters(db, q, limit, offset, isOnline)`.
- `getCharacterDetail(db, characterId)`: account, character, inventory, equipment, warehouse (via `loadInventory`/`loadWarehouse`).
- `listItemLogs`, `listGoldLogs`, `listAdminLogs`, `listChatLogs` with q/character/date/UUID filters.
- `writeAdminLog(db, entry)`.

### Task 5 — Pure admin item planners
**Files:** `apps/server/src/items/planning.ts`, `apps/server/test/items/adminPlanning.test.ts`.

**Key functions**
- `planAdminGive(state, characterId, definition, quantity, upgradeLevel, bonuses, newId)` using `addItem`, returning an `ItemPlan` with `createdBy:"admin"` and `admin_grant` logs.
- `planAdminRemove(state, characterId, instanceId)` handling inventory **or equipped** items, with `admin_remove` logs, plus state cleanup for equipment.
- Tests: stacking/full inventory, +5 upgrade persistence, equipped-item removal, atomic full-bag failure.

### Task 6 — Admin mutation service
**Files:** `apps/server/src/admin/adminMutations.ts`, tests `apps/server/test/db/adminMutations.test.ts`.

**Key functions**
- `banAccount`, `unbanAccount` (lock account, set ban fields, bump tokenVersion on ban, write `admin_log` in the same transaction).
- `updateCharacterOffline` (level/stats/position, clamp; recompute max HP/MP on join; write log).
- `setGoldOffline` (lock character, compute delta, write `gold_log` + `admin_log`).
- `grantItemOffline` / `removeItemOffline` using Task 5 planners + `applyItemTransaction`.
- DB tests for every mutation, audit rows, permanent-ban sentinel, and player-role refusal.

### Task 7 — Live admin bus + service wiring
**Files:** `apps/server/src/admin/liveBus.ts`, `apps/server/src/services.ts`, `apps/server/src/server.ts`, `apps/server/test/admin/liveBus.test.ts`, `apps/server/test/rooms/fakes.ts`.

**Interface**
```ts
AdminPresence { accountId, characterId, sessionId, name, mapId, channel, level, role, x, y, hp, maxHp, dead }
AdminLiveActions {
  presence(): AdminPresence;
  grantItem(input): Promise<AdminItemResult>;
  removeItem(instanceId): Promise<void>;
  setGold(gold): Promise<void>;
  updateCharacter(input): Promise<void>;
  teleportTown(): Promise<void>;
  spawnMonster(typeId, count, x?, y?): Promise<number>;
  announce(payload): void;
}
AdminBus {
  register(characterId, roomId, actions);
  unregister(characterId, sessionId);
  unregisterRoom(roomId);
  get(characterId); list(); findByName(name);
  broadcastAnnouncement(payload): number;
  onlineHistorySample(): number;
}
```
- `ServerServices` gains `adminBus`, `adminRuntime`, `logChat`; `createGameServer` installs real implementations; test fakes get no-op versions.
- This task only the bus + wiring; MapRoom registers in Task 8.

### Task 8 — MapRoom registration and live admin actions
**Files:** `apps/server/src/rooms/playerRuntime.ts`, `MapRoom.ts`, `apps/server/src/rooms/adminActions.ts`, `spawnManager.ts`, tests `apps/server/test/rooms/adminActions.test.ts`.

**Changes**
- `PlayerRuntime` gains `role` and `invisible`.
- Register bus actions after session-registry acceptance; unregister on leave and after warp; `onDispose` calls `unregisterRoom`.
- `adminCommand(runtime, fn)` serializes admin mutations on `runtime.inventoryChain` and rejects when closed/warping/dead as appropriate.
- Actions: grant/remove item (apply plan, snapshot), set gold (delta via `items.apply`), update level/stats (recompute maxima, dirty/save, selfStats), teleport town (`beginWarp`/spawn), spawn monster (new `spawnAdminMonster`), announce (all clients).
- `MapRoom.saveAllForShutdown()` for graceful shutdown.
- Room tests: live +5 sword appears in snapshot; remove equipped item updates visuals; gold/level changes; announcement; warp registration handoff.

### Task 9 — GM commands and chat logging
**Files:** `apps/server/src/admin/gmCommands.ts`, `MapRoom.ts`, `services.ts`, tests `apps/server/test/admin/gmCommands.test.ts`, `rooms/gmCommands.test.ts`.

**Changes**
- Parse `/goto`, `/warp`, `/summon`, `/spawn`, `/item`, `/level`, `/invisible`, `/kick`; role check; system reply for errors.
- Write `admin_log` for every command.
- `logChat` inserts `chat_log` asynchronously (no room-tick await).
- Tests: parser, player-role refusal, `[item]` grant, level change, invisible AI exclusion.

### Task 10 — Admin runtime: rates, metrics, announcements, shutdown
**Files:** `apps/server/src/admin/adminRuntime.ts`, `services.ts`, `MapRoom.ts` (XP/drop usage), tests `apps/server/test/admin/adminRuntime.test.ts`.

**Key functions**
- `settings { xpRate, dropRate, shutdown }`, setters, in-memory 24 h online history sampler.
- `xpRate` applied in `awardKillXp`; `dropRate` applied to drop chances in `spawnDrops`.
- Recurring announcement loop (30 s) reading active rows and broadcasting.
- `scheduleShutdown({at, message})` / cancel; countdown announcements; at deadline save all rooms then `server.gracefullyShutdown(true)`.
- Tests with fake clock/timers and fake server; XP/drop integration assertions.

### Task 11 — Admin read routes
**Files:** `apps/server/src/routes/admin.ts`, `server.ts`, tests `apps/server/test/api/adminRead.test.ts`.

**Routes:** `GET /api/admin/dashboard`, `/api/admin/players`, `/api/admin/players/:characterId`, `/api/admin/logs/item|gold|admin|chat`, `/api/admin/online`, `/api/admin/monitor/status`.
- All under `requireAuth` + `requireRole("gm","admin")`; no admin route leaks inventory of other accounts.
- Tests: 401/403, dashboard online counts with fake bus, search/detail, log filters, monitor status.

### Task 12 — Admin mutation routes
**Files:** `routes/admin.ts`, tests `apps/server/test/api/adminMutations.test.ts`.

**Routes:** ban/unban/kick, edit character (level/gold/stats/position), teleport town, give item, remove item.
- Online → use live bus; offline → DB service path.
- Ban: DB commit first, then kick; response returns ban state.
- Give item full bag → 409 `conflict`; no partial grant.
- Tests: ban kicks and login then returns `account_banned`; unban restores login; online grant appears in room; offline grant lands in DB; role guard.

### Task 13 — Admin announcement/control routes
**Files:** `routes/admin.ts`, `adminRuntime.ts`, tests `api/adminControls.test.ts`.

**Routes:** create/list/delete announcements, set XP/drop rates, spawn monster/boss, schedule/cancel shutdown.
- Immediate announcement writes DB + broadcasts; recurring rows are picked up by Task 10.
- Spawn validates monster id/count; shutdown validates delay/message.
- Tests: validation, audit rows, rate changes, shutdown schedule cancellation.

### Task 14 — Colyseus monitor mount
**Files:** `pnpm-workspace.yaml`, `apps/server/package.json`, `apps/server/src/routes/monitor.ts` (or `server.ts`), tests `api/monitor.test.ts`.

- Add `@colyseus/monitor: 0.17.9` to catalog/dependency.
- Mount `app.use("/colyseus", requireAdminCookie, monitor(options))`; inspect installed typings first.
- Dev proxy in admin app points `/colyseus` to `:2567`.
- Tests: no cookie → 401; admin cookie → 200; player cookie → 403.
- Verify `pnpm build`/real server serves the monitor assets; if esbuild static-path breaks, externalize the package (record in DECISIONS).

### Task 15 — Client announcement banner and kick reasons
**Files:** `apps/client/src/network/session.ts`, `ui/store.ts`, `ui/App.tsx`, new `ui/AnnouncementBanner.tsx`.

- Bind `MSG.announcement`; store last announcement; top-center dismissible banner with kind styling.
- Handle `sessionKicked` reasons `admin` (keep tokens, return to character select) and `ban` (clear tokens, login message).
- Typecheck/build + manual banner check.

### Task 16 — Admin app foundation
**Files:** `apps/admin/vite.config.ts`, `apps/admin/package.json`, `apps/admin/src/network/{tokens,api}.ts`, `src/store.ts` (or React context), `src/App.tsx`, `src/components/*`, `src/index.css`.

- Add `@jadethrone/data` (item/monster names) and `zustand` if useful; keep no router dependency (page state in store).
- Proxy `/api` and `/colyseus` to `localhost:2567`; `ws: true` for monitor.
- Token store in `sessionStorage`; API client with one shared refresh rotation and 401 retry.
- Login page: email/password, role rejection, session restore, logout.
- Shell: sidebar tabs (Dashboard, Live Rooms, Players, Game Data, Announcements, Logs, Server), account header, error banner.
- `base: "/admin/"` in production build (dev stays `/`).

### Task 17 — Admin dashboard and Live Rooms pages
**Files:** `apps/admin/src/pages/DashboardPage.tsx`, `LiveRoomsPage.tsx`, `components/StatCard.tsx`, `components/OnlineChart.tsx`.

- Dashboard cards: online total, per map/channel, uptime, memory/CPU, registrations today, gold in economy; SVG polyline chart from history.
- Auto-refresh every 10 s; no chart library.
- Live Rooms: room summary table + `@colyseus/monitor` iframe at `/colyseus`; refresh/open-new-tab; show auth error if monitor status fails.

### Task 18 — Admin player search and detail
**Files:** `pages/PlayersPage.tsx`, `components/PlayerDetail.tsx`, `components/ItemList.tsx`, `components/ItemTooltip.tsx`.

- Debounced search by email/username/character name; online badge, level/class/map/gold/ban state.
- Detail tabs: stats, inventory, equipment, warehouse; item names/rarity/upgrade/bonuses; tooltips.
- Read-only refresh; no editing yet in this task.

### Task 19 — Admin player actions
**Files:** `pages/PlayersPage.tsx`, `components/PlayerActions.tsx`.

- Give item form (definition select from data, quantity, upgrade 0–9, bonuses) → POST; show 409 on full bag.
- Remove item buttons per instance.
- Edit level/gold/stats; teleport to town; kick; ban with duration/reason; unban.
- Re-fetch detail/logs after each action; confirm dialog for destructive actions.

### Task 20 — Admin announcements, server controls, game data
**Files:** `pages/AnnouncementsPage.tsx`, `ServerPage.tsx`, `GameDataPage.tsx`.

- Announcements: send immediate, list/delete recurring, interval/expiry.
- Server: XP/drop rates, spawn monster/boss form, shutdown schedule/cancel with countdown state.
- Game Data: read-only tables for items/monsters/drop tables/shops/spawn groups/NPCs, search and JSON detail; banner "Editing arrives in Phase 7".

### Task 21 — Admin logs page
**Files:** `pages/LogsPage.tsx`, `components/LogTable.tsx`.

- Tabs: Item, Gold, Admin, Chat; filters by character, item UUID, date range; pagination.
- Trade tab placeholder ("No trades until Phase 7").
- JSON detail expander for admin/action details.

### Task 22 — Verification tooling and docs
**Files:** `scripts/verify-phase5-e2e.mjs`, maybe `scripts/verify-phase5-admin.mjs`, `PROGRESS.md`, `DECISIONS.md`, `docs/reports/phase-5.md`.

- Live E2E: admin login → dashboard → player online → give +5 sword (player inventory snapshot) → announcement banner → ban (kicked, login 403) → unban → monitor cookie 200/401 → admin logs contain actions.
- Record decisions: audit policy, monitor cookie, in-memory rates/metrics, permanent ban sentinel, read-only data, admin bus single-process.

### Task 23 — Phase gate
`@reviewer`, fix findings, run full checks, start the stack, manual browser acceptance, write report, stop.

---

## 3. Hard systems: exact approach and edge cases

### 3.1 Admin live bus
Each `MapRoom` registers a per-character action object after the session registry accepts the join. Registration is keyed by `characterId` and stores the session id; `unregister(characterId, sessionId)` is conditional, so an old room's late `onLeave` cannot remove the new session after a warp/duplicate join. On warp, the old room unregisters before the target joins; on room dispose, `unregisterRoom(roomId)` clears all entries belonging to that room. Announcements iterate registered actions and send `MSG.announcement` to every client. This is intentionally in-process; Phase 10 can replace it with pub/sub when horizontal scaling lands.

### 3.2 Ban / kick ordering
Ban locks the account row, sets `bannedUntil`/`banReason`, increments `tokenVersion`, inserts `admin_log`, commits, then `sessionRegistry.kickAccount(accountId,"ban")`. After the bump, stale reservations/JWTs fail `onAuth`, `requireAuth` and refresh. Unban clears the fields but does **not** bump tokenVersion. Admin kick (without ban) does not bump tokens, sends `sessionKicked {reason:"admin"}` and returns the player to character select.

Permanent ban uses a far-future max date sentinel (recorded), because `bannedUntil IS NULL` means "not banned".

### 3.3 Give/remove item
Online: validate definition/upgrade/quantity, enqueue on `runtime.inventoryChain`, run `planAdminGive`/`planAdminRemove`, apply through the existing item transaction, update the snapshot and log. Full inventory is atomic: nothing is granted. Offline: load inventory, run the same planner and transaction. The route checks bus presence immediately before choosing the path; a join race is resolved by the recorder: if the player is offline the DB row is updated, and the join loads it. +5 items are ordinary rows with `upgradeLevel: 5`; `effectiveItemStats` already reads the upgrade chain.

### 3.4 Character edit / gold / teleport
- Level/stats are clamped (1–99, 0–90 per stat); recompute max HP/MP, clamp current, set dirty, save, send owner `selfStats`, and refresh public max HP/MP.
- Gold is an absolute admin edit converted to a delta under the character row lock; the existing `gold_log` records `reason:"admin"`. Never write gold through `CharacterSave`.
- Position edits are same-map only; `teleport to town` uses the existing warp path (or the village spawn when already in town). Cross-map movement always goes through `beginWarp`, never a raw state patch.
- Live room actions run on the room thread/queue; no direct mutation of a runtime from an HTTP handler.

### 3.5 Announcements
Immediate: insert `announcements` + `admin_log`, then broadcast. Recurring: the runtime polls active rows every 30 s and sends when `lastSentAt` is older than `intervalMs`; `expiresAt` stops delivery. A single process owns the loop (no multi-process duplication yet). The client displays the last banner with a dismiss button.

### 3.6 Shutdown
`AdminRuntime` stores `shutdownAt` and broadcasts countdown messages at fixed thresholds through the live bus. At the deadline it calls each local room's `saveAllForShutdown()` (dirty runtimes, inventory chains awaited), sends a final announcement, then `server.gracefullyShutdown(true)`. Canceling clears the timer. If a room has no players it skips. The scheduler is injectable for tests and cannot be scheduled in the past.

### 3.7 Monitor auth
Login/refresh for gm/admin sets an HttpOnly `jt_admin` cookie containing the access JWT; `/colyseus` verifies cookie signature, current token version, role and ban state on every request. This keeps the iframe working without putting bearer tokens in a URL. SameSite=Lax prevents cross-site POST; the monitor is only reachable on the same origin/proxy. In dev, Vite proxies `/colyseus`; in production Phase 10 serves both under `/admin`/same host. Monitor can be removed/externalized if the bundled static path fails.

### 3.8 Admin API client/auth
The admin app uses relative `/api` calls. Access/refresh tokens stay in `sessionStorage` (not cookies), so REST admin mutations are not CSRF-exposed. One shared refresh promise rotates tokens once; login/refresh responses also refresh the monitor cookie. Every admin route is server-guarded; a player-role token gets 403 even if the UI is bypassed.

### 3.9 Game data
Read-only in Phase 5. The admin app imports the same `@jadethrone/data` modules the server uses, so values cannot drift. Editing/overrides/hot reload remains Phase 7 as specified.

---

## 4. Tests

**Shared**
- `packages/shared/test/admin.test.ts`: every admin schema's bounds, "at least one update field", item/upgrade/bonus limits, forbidden/conflict error typing.

**Server unit**
- `http/adminCookie.test.ts`: cookie set/clear, role rejection, expired/token-version/banned cookie.
- `admin/liveBus.test.ts`: conditional unregister, room cleanup, findByName, broadcast counts.
- `items/adminPlanning.test.ts`: give/remove inventory + equipment, full bag atomicity, +5 persistence.
- `admin/gmCommands.test.ts`: command parsing, role refusal, bounds, system errors.
- `admin/adminRuntime.test.ts`: XP/drop rates, recurring announcements, shutdown/cancel, history sampling.

**Server DB (gated on `TEST_DATABASE_URL`)**
- `db/adminRead.test.ts`: search, dashboard counts/gold, detail inventory/equipment/warehouse, log filters.
- `db/adminMutations.test.ts`: ban/unban + tokenVersion, permanent ban, gold log, level/stat clamp, offline give/remove + `item_log`.
- `db/adminLog.test.ts`: every action writes an `admin_log` row.

**HTTP API (real DB)**
- `api/adminRead.test.ts`: 401/403, dashboard, player search/detail, logs, monitor status.
- `api/adminMutations.test.ts`: give +5, full-bag 409, ban→kick→login rejected, unban, offline/online paths, teleport.
- `api/adminControls.test.ts`: announcement send/list/delete, rates, spawn validation, shutdown scheduling.
- `api/monitor.test.ts`: no cookie 401, admin cookie 200, player cookie 403.

**Room tests**
- Admin bus registration/unregistration on join/leave/warp/dispose.
- Live grant +5 item snapshot, remove equipped item, gold/level update, announcement delivery, spawn monster, GM commands.

**Client/build**
- No React test harness exists; verify admin via `pnpm typecheck`, `pnpm build`, and manual browser checks. Add pure tests only where a helper is not UI-bound.

**Scripts**
- `verify-phase5-e2e.mjs` as described in Task 22.

---

## 5. Acceptance criteria verification

| Criterion | Automated evidence | Manual check |
|---|---|---|
| Admin can log in | API tests: admin/gm role passes, player gets 403; E2E login | Sign in at `:5174` with seeded admin |
| See live players | Bus/room tests + dashboard API test + E2E online count | Dashboard shows online count per map/channel |
| Colyseus monitor tab | Monitor cookie tests; E2E 401/200 | Live Rooms iframe loads `/colyseus` |
| Find a character | Search API/DB tests | Search by character/account name |
| Give +5 sword live | Room test + route test + E2E inventory payload `upgradeLevel:5` | Player sees the sword without relogging; tooltip shows +5 |
| Ban and block login | DB/route tests + E2E login 403 | Ban from player detail; player is kicked; login is refused |
| Send announcement in game | Route/runtime tests + E2E announcement message | In-game banner appears |
| GM commands | `gmCommands` unit + room tests | Type `/item sword_ember_t1 1`, `/level 10`, `/goto`, etc. |

Gate also runs `pnpm typecheck`, `pnpm lint`, `pnpm build`, full `pnpm test` with `TEST_DATABASE_URL`, both verification scripts, and a real server boot.

---

## 6. Risks and mitigations

1. **Monitor static assets inside the esbuild CJS bundle** — install, mount, run `pnpm build`, then start the bundle and load `/colyseus`; if paths break, externalize `@colyseus/monitor` and record it.
2. **Monitor auth cookie in dev proxy** — use HttpOnly access JWT, SameSite=Lax, `Secure` only in production; test with Vite proxy and direct server.
3. **Admin live bus is in-process only** — acceptable for the current single instance; record the limitation; Phase 10 replaces it with pub/sub.
4. **Ban/kick races** — commit the tokenVersion bump before kicking; conditional bus unregister; `onAuth`/`requireAuth` already re-check the DB.
5. **Item/gold duplication through admin paths** — reuse the existing item transaction and locks; never write items or gold directly from HTTP; full-bag atomic failure.
6. **Admin edits fight autosave/inventory chain** — serialize live edits on `inventoryChain`, mark dirty, await the save; keep gold out of `CharacterSave`.
7. **Recurring announcements duplicate** — single-process scheduler; unique row + `lastSentAt`; make the loop idempotent.
8. **Settings lost on restart** — rates/history are in-memory in Phase 5; record this; Phase 10/persistence can add a settings table.
9. **Admin UI bypass** — server-side role guard on every route and monitor cookie; client-side role check is UX only.
10. **Cross-origin admin in dev** — Vite proxy for `/api` and `/colyseus`; no wildcard CORS.
11. **MapRoom growth** — put admin command logic in `rooms/adminActions.ts`/`adminCommands.ts`, routes in `routes/admin.ts`, bus in `admin/`.
12. **Permanent ban sentinel confusion** — use an explicit far-future date and document it; unban clears both fields.
13. **E2E depends on seeded admin** — fail with a clear "run `pnpm seed`" message; allow `SEED_ADMIN_*` overrides.
14. **Login rate limits during repeated acceptance runs** — restart or wait; admin routes themselves get a small limiter only if needed.
15. **Trade logs don't exist until Phase 7** — Logs page shows an explicit empty Trade tab rather than inventing data.
