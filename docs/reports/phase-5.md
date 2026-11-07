# Phase 5 — Admin panel: report

Date: 2026-11-07

## What was built

Phase 5 delivers the browser admin panel, the server admin surface behind it, and the live
plumbing that lets both reach players in game. Everything from GAME_DESIGN.md §10.5 is present
except hot-reloadable game-data editing, which stays in Phase 7 as planned.

### Server

- **Admin authentication.** Admin routes sit behind `requireAuth` + `requireAdmin` (`gm`/`admin`
  only). Admin login also sets the HttpOnly `jt_admin` access-token cookie used by the Colyseus
  monitor iframe; the monitor checks signature, token version, role and ban state on every
  request. Malformed cookies are treated as absent.
- **Read services and routes.** Dashboard (live players by map/channel, registrations, gold in
  economy, uptime/memory/CPU, 24 h online history, live rooms), account/character search with
  online state, full character detail (stats, inventory, equipment, warehouse, derived max
  HP/MP), and paginated item/gold/admin/chat log queries with text, character, item UUID and
  date filters.
- **Mutations.** Live and offline give/remove item, absolute gold, level/stat edits, teleport
  town, kick, ban and unban. Live actions run on the room's inventory chain through the same
  planners/transaction executor as player actions; offline actions reuse the load/plan/apply
  path. Offline item and character mutations re-check the live bus inside the operation and
  refuse with `409` if the player joined meanwhile.
- **Ban ordering.** Ban locks the account, bumps `tokenVersion`, writes the audit row and
  commits, then calls `noteAccount` with the new generation *before* kicking, so a join that
  passed `onAuth` before the ban cannot register with a stale reservation. Unban clears the
  fields without another bump.
- **Audit.** Item changes write item logs inside their transaction and an `admin_log` row
  (`item_grant`/`item_remove`); admin actions write `admin_log` with actor, target, detail and
  IP. Post-commit audit failures are logged but no longer turn a successful action into a 500.
  GM commands write `admin_log` asynchronously with a caught failure.
- **Runtime controls.** In-memory XP/drop event multipliers (applied to kill XP and drop
  chances), 30 s recurring announcements with an in-flight guard, shutdown scheduling with
  countdown banners, and graceful room save/shutdown.
- **Live admin bus.** Per-character live actions and per-room handles, registered after session
  acceptance and removed conditionally on session id. Rooms are summarized for the panel with
  start time and capacity.

### Shared

Admin DTOs and Zod schemas (`admin.ts`), admin error codes, `MSG.announcement` /
`AnnouncementPayload`, session kick reasons, and derived `banned` flags on account/character
summaries. Admin caps now reuse `MAX_LEVEL`, `STAT_POINT_CAP` and the new `MAX_ADMIN_SPAWN`
instead of duplicated literals.

### Client

Admin/ban kicks return to the correct screen, and the in-game announcement banner renders
admin, scheduled and shutdown messages.

### Admin panel (React/Vite)

- Session-scoped tokens, refresh rotation with one shared in-flight refresh and a 401 retry.
- Login form, authenticated shell, sidebar and page routing for all seven pages.
- **Dashboard:** stat cards, SVG online-history chart, per-map breakdown, online list; 10 s poll.
- **Live Rooms:** monitor cookie status, live room table (map, id, players, capacity, start time),
  per-map room overview, and the authenticated monitor iframe (hidden with an explanation when
  the cookie is missing).
- **Players:** debounced search by email/username/character name, account-only results with
  unban, detail tabs (stats, inventory, equipment, warehouse), rarity tooltips, and actions:
  give item with upgrade level, remove owned item, edit only changed level/gold/stats, teleport
  town, kick, ban and unban.
- **Game Data:** read-only tabs for items, monsters, drop tables, shops, spawn groups and NPCs,
  with filter and definition detail. Editing is intentionally absent until Phase 7.
- **Announcements:** immediate or recurring announcements with optional expiry, history and
  delete. Numeric fields are validated instead of silently becoming `NaN`.
- **Server:** status, live rate multipliers, monster spawn, maintenance shutdown schedule/cancel,
  with validated numeric inputs and form state that survives polling.
- **Logs:** item, gold, admin and chat tabs with search/character/item-UUID/date filters,
  pagination and JSON detail expansion; Trades tab explains it arrives in Phase 7.

### Tooling and docs

- `scripts/verify-phase5-e2e.mjs` and `pnpm verify:phase5-e2e`: live acceptance for admin login,
  monitor cookie/401, dashboard presence, live +5 sword, announcement banner, ban kick + 403
  login, unban + login, monitor authorization and audit-log rows.
- `DECISIONS.md` D54–D58 record the live bus, ban/cookie ordering, mutation reuse, in-memory
  runtime values and read-only game data.
- Regression tests added for ban-versus-stale-registration, the admin XP multiplier reaching
  kill XP, and the persisted server-rate audit row.

## How to run

```bash
pnpm install
pnpm seed          # creates admin@example.com + test player@example.com from .env
pnpm dev           # Postgres, server :2567, client, admin panel :5174
```

Admin panel: <http://localhost:5174> (dev). Use the credentials from `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` in `.env`.

Other commands:

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test          # set TEST_DATABASE_URL to a disposable database for DB tests
pnpm verify:phase5-e2e
```

## How to verify each acceptance criterion manually

1. **Admin can log in.** Open the panel, sign in with the seeded admin. Wrong credentials show an
   error; a player account is rejected with “does not have admin access”.
2. **Live players and the Colyseus monitor tab.** Open **Live Rooms**. The room table shows the
   running rooms and counts; the embedded monitor loads. Log in as a player and open a room:
   the player appears in **Dashboard → Online now** and **Live Rooms** within 10 s. The monitor
   loads in the iframe because the admin login set the HttpOnly cookie.
3. **Find a character.** Open **Players**, type the seed player's email, username or character
   name. Select the result; stats, inventory, equipment and warehouse tabs load.
4. **Give a +5 sword that appears live.** With the player in game, use **Give item**, choose
   `sword_ember_t1`, quantity 1, upgrade 5, click **Give item**. The item appears in the in-game
   inventory immediately (and in the detail inventory tab after refresh), with a `+5` name.
5. **Ban (kicked and cannot log in).** In **Players**, choose a duration and reason, click
   **Ban**. The player is removed from the game with the ban message. Logging in with that account
   returns 403. **Unban account** restores login.
6. **Announcement appears in game.** Open **Announcements**, type a message, leave the interval
   empty and click **Send now** (or set an interval for a recurring message). The in-game banner
   appears for every online player; recurring rows can be deleted from the history list.
7. **Extra surface (Task 20/21).** Change XP/drop rates in **Server**, spawn a monster while a
   player is online, schedule/cancel a shutdown. Browse **Game Data** (read-only) and filter
   **Logs** by actions or character; expand a row's JSON detail. The ban/grant actions performed
   above appear in the admin/item logs.

## Automated verification run

- `pnpm typecheck`, `pnpm lint`, `pnpm build`: pass.
- `pnpm test` against the disposable `jade_throne_test` database: **68 files / 595 tests pass**.
- `pnpm verify:phase5-e2e` against a live dev server: **20/20 checks pass**.

## Known issues and intentional limits

- The admin live bus, event multipliers, dashboard history, announcement scheduler state and
  shutdown schedule are in-process. One server instance is assumed; Phase 10 can add pub/sub.
- Game data is read-only; hot reload is a Phase 7 deliverable. The Trades log tab is a Phase 7
  placeholder.
- Warehouse item removal is not exposed in the admin panel; use the player's warehouse. Only
  inventory and equipped items can be removed.
- Live character edits submit only changed fields, but there is no optimistic-concurrency
  version on the character row. A player joining in the narrow window after the offline
  online-check can still overwrite an offline edit on the next autosave; the route's check makes
  this unlikely and a retry goes through the live path.
- The `verify:phase5-e2e` script creates accounts and performs logins; the server rate limiter
  allows 10 logins per 15 minutes per IP. Restart the dev server before repeating a run.
- The admin panel is a Vite dev app in Phase 5; production static serving/deployment is Phase 10.
- Dashboard CPU percentage is the process lifetime average, not an instantaneous sample.
- Expired bans are no longer shown as active, but the account/character payload still includes
  the historical `bannedUntil` date for auditing.
