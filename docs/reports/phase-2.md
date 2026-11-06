# Phase 2 — Accounts and characters: Report

Built against `docs/plans/phase-2.md`. This report covers the phase gate: the four required commands, the real-Postgres suites, both end-to-end scripts, a fresh `@reviewer` pass, fixes for every IMPORTANT finding, and the remaining accepted minors.

## What was built

- **Database**: committed Drizzle schema/migration for `accounts`, `characters` and `sessions` (case-insensitive `lower(...)` unique indexes for email/username/character name; application-generated UUIDs). `pnpm db:migrate` applies it; the server also migrates in the background on boot so an unreachable DB never blocks `/api/health`.
- **Auth**: register/login/refresh/logout REST endpoints, Argon2id passwords, HS256 access tokens (1 h) with a token-version generation check, rotating refresh tokens stored only as SHA-256 hashes, per-IP rate limits before password work, ban checks, and a single service-error taxonomy mapped to the shared `ApiErrorBody`.
- **One session per account**: login/logout bump `token_version` and revoke refresh sessions; an in-process `SessionRegistry` saves, notifies (`sessionKicked`) and closes the old socket with code 4100. Registrations are serialized per account and carry the token generation, so a seat reserved before a login bump is rejected instead of kicking the newer session.
- **Characters**: up to four per account, 3–16 ASCII alphanumeric unique names (case-insensitive), four classes with data-driven starting stats, gender/hair appearance, HP/MP from shared formulas, ownership checks, slot `FOR UPDATE` race protection, and online-delete blocking.
- **Persistence**: load on join, save on leave, save before a warp, and a 60 s dirty autosave. All writes for a player are serialized through a per-player promise chain and clear `dirty` only if the player has not moved since the snapshot. Invalid saved positions fall back to the map spawn.
- **Warps**: the destination is saved before reserving a target seat; the server issues a single-use warp token bound to account/character/map/token-generation (no JWT re-verification, so an expired access token cannot break a map change). Failure restores the player, writes the source position back, and applies the usual cooldown; a client that disappears before receiving the reservation is rolled back.
- **Client**: REST client with one shared refresh-and-retry, per-tab `sessionStorage` tokens, boot restore, login/register screen with kingdom choice, 4-slot character select with create/delete and a live layered preview, in-game logout, and kick handling ("signed in from another location" / duplicate tab). The world hides the local sprite until the first authoritative patch, resets predictor/pointer state on session changes, and renders players from a procedural layered canvas texture keyed by class/gender/hair.
- **Tooling**: idempotent `pnpm seed`, auth-aware Phase-1 E2E, new Phase-2 E2E, updated smoke test, CI Postgres 18 service with migrations before tests, README/ASSETS/plan/decisions updates.

## Reviewer findings fixed

- **Stale reservations after a token bump**: `SessionHandle` now carries `tokenVersion`; the registry tracks the account's latest generation and rejects older reservations. Warp tokens are bound to the generation too. Login/register/refresh/logout routes call `noteAccount` before kicking.
- **Registry concurrency**: `register` is serialized per account, re-checks the generation after any awaited kick, and refuses to overwrite a newer handle. A three-way concurrent-register test was added.
- **Save ordering**: autosave, kick, leave and warp writes now share a per-runtime promise chain; `dirty` is cleared only when the runtime did not move during the save. A warp that loses its client before the reservation is written back to the source; a client that ignores the warp message is rolled back before disconnect.
- **Client session leakage**: the predictor/pointer/path state is reset on logout/kick/session change; pointer input is ignored while not connected; the predictor only updates for the current room session. `connect` leaves an existing room first. A warp now marks the map switch so `update()` cannot queue a second restart.
- **Kick UX and multi-tab tokens**: tokens moved to per-tab `sessionStorage`; refresh failure only clears tokens for a terminal 401/403 and only if that refresh token is still current. The kick reason is rendered on the login screen; a `logout` reason is distinguished from `login`; `setAuthenticated` clears stale kick reasons.
- **Test-DB safety**: `vitest.setup.ts` forces `DATABASE_URL` to `TEST_DATABASE_URL` (never silently uses a dev DB), and the HTTP route suite migrates before booting, so a fresh test database works without CI's pre-migration. README corrected.
- **Minor fixes**: delete checks ownership before the online flag; character routes send `Cache-Control: no-store`; character-select mutations read the latest store list; auth submit validates email/username; `logout()` no longer rejects on a closed socket; the preview painter no longer draws outside the canvas.

## Remaining known issues (accepted for this phase)

- **Warp token is consumed during matchmaking**: if the target room is full and Colyseus retries the seat reservation, the retried attempt has no token. Target rooms hold 200 players; this is deferred until channels/load tests (Phase 9/10).
- **Warp retry/leave timeout**: 2 s is tight at very high RTT; the client normally leaves immediately.
- **One corrupt character row can block login** (`toCharacterSummary` throws inside the login transaction). Rows are validated on write; a repair/cleanup path is a later admin concern.
- **Idle walk bob** (the forever squash/stretch tween) is cosmetic and Phase-1 heritage.
- **Rate limits are not env-configurable**: repeated acceptance runs from one IP need a server restart (or wait 15 minutes). Fine for the phase; a dev override belongs with deployment settings.
- **Long files**: `MapRoom.ts` (~640 lines) and `accountService.ts` mix several concerns. A systems split is deferred to a later refactor (the phase plan already lists this).
- **Known Phase-1 minors remain**: chat range 900 vs interest-add 850, per-message invalid-input/chat warnings, and the 2 s warp timeout.

## Verification

Green on the final tree:

```
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test        # 29 files, 269 tests, TEST_DATABASE_URL=.../jade_throne_test
pnpm build
```

Acceptance runs against the real server (`tsx`) and Postgres:

```
node scripts/verify-phase2-e2e.mjs
PASS register returns tokens
PASS new account has no characters
PASS character created
PASS character starts in the village
PASS own player is visible
PASS character id matches
PASS appearance is synced
PASS walking moves the authoritative character
PASS character still exists after logout
PASS saved position matches the last authoritative position
PASS saved map matches
PASS rejoin spawns at the saved position
PASS second login kicks the first session (reason=login)
PASS stale access token is rejected
PASS character delete returns 204
PASS character list is empty after delete
PASS logout returns 204
PHASE 2 E2E PASS
```

The auth-aware Phase-1 script also passes (13/13), including both warps and **warp persistence across logout/login**:

```
PASS own player is visible
PASS other player is visible
PASS movement acknowledged
PASS movement applied
PASS other client receives the remote position
PASS local chat delivered
PASS warp to fields issued
PASS warp target is the fields spawn
PASS warp reservation consumed
PASS arrived on the fields map
PASS return warp to village issued
PASS return warp consumed
PASS arrived back in the village
PASS warp destination is persisted
PASS post-warp position is persisted
PHASE 1 E2E PASS
```

`pnpm seed` was run twice; the second run skipped the existing accounts and characters. The smoke test confirms health `db: "up"`, anonymous matchmaking rejected with AUTH_FAILED (525), and `/api/auth/me` returning 401.

## How to run

```sh
pnpm install
pnpm db:migrate
pnpm seed            # optional
pnpm dev             # server :2567, client :5173, admin :5174
```

For the DB-backed tests, create `jade_throne_test` once and set `TEST_DATABASE_URL`; the suites apply the committed migrations themselves.

## Manual acceptance checklist

1. Open http://localhost:5173. Register a new account (email, username, password, kingdom). You land on the character-select screen.
2. Create a character (name, class, gender, hair style/colour); the preview and the in-world sprite match.
3. Click **Play**, walk with WASD/click. Open a second browser profile/tab, register another account, and confirm both players see each other move smoothly.
4. Click **Log out**. Log back in with the same account; the character list shows the same character.
5. Click **Play** again; the character is where you left it (try leaving on the fields map).
6. Log in from a second tab/profile with the same account while the first is in game: the first tab shows "Signed in from another session" and returns to login; its old token cannot rejoin.
7. Delete a character from the select screen; it disappears after the confirmation.

## Next phase

Phase 3 — combat and monsters (monster data, packs, AI, arc attacks, damage/crit, HP/MP, regen, death/respawn, XP and levels). The character row already carries level/xp/hp/mp/stats/points, and the room tick has the dirty/persistence seams Phase 3 can extend.
