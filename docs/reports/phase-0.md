# Phase 0 — Foundation: Report

Executed `docs/plans/phase-0.md` tasks 1–16 in order; every task committed individually (see `git log --oneline`). Reviewer findings from the task-16 pass fixed in commit `4e750d0` (`fix: phase 0 reviewer findings`).

## What was built

- **Monorepo**: pnpm 12.16.1 workspaces + single-sourced version catalog; TypeScript 5.9.3 strict base config; ESLint 10 flat config; Prettier; Vitest (root runner).
- **`packages/shared`**: game constants (tiles, tick rate, kingdoms, rarities, spawn), seeded RNG (`mulberry32` + FNV-1a) with a Vitest suite incl. pinned reference values, `HealthPayload` type + guard shared by server and client.
- **`packages/data`**: placeholder skeleton for JSON balance data + maps (`*-*.tmj` in later phases).
- **`apps/server`**: Colyseus 0.17.11 via `@colyseus/core@0.17.56`, zod-validated env config that derives `DATABASE_URL` from `POSTGRES_*` parts, pino logging, `GET /api/health` (2 s DB deadline + singleflight pings), minimal `world` room with schema-4 decorated `WorldState` (name/x/y/kingdom), zod-validated join options, sanitized display names, `maxMessagesPerSecond` rate limit, CJS production esbuild bundle, headless smoke script (`node scripts/smoke-server.mjs [--dist]`).
- **`apps/client`**: Vite 8 + Phaser 4.2.1 + React 19 overlay (zustand), asset manifest with strict validation, procedural placeholder generation under the same texture key for missing art (seeded, deterministic), demo world scene: generated tile ground (grass / dirt path cross / water edge / stone spawn courtyard), placeholder character with shadow + facing arrow + idle squash-and-stretch, example item icon, camera zoom 2 + lerp follow, `/api/health` status badge polling every 5 s.
- **`apps/admin`**: React 19 + Tailwind v4 themed login skeleton (glassy dark card, gold border, jade accents) — visual only.
- **Infra**: root `docker-compose.yml` (Pi Postgres, `postgres:18-alpine` multi-arch), `.env` handling with committed `.env.example`, `scripts/dev-db.mjs` reachability check (never fatal), `scripts/smoke-server.mjs`, `pnpm dev` orchestration via `concurrently`, GitHub Actions CI workflow, README + ASSETS.md + credits skeleton.

## How to run

```sh
pnpm install
cp .env.example .env        # set POSTGRES_* (Pi host/ports) if desired
pnpm dev                    # db check + server :2567 + client :5173 + admin :5174
pnpm build | pnpm test | pnpm typecheck | pnpm lint | pnpm format:check
node scripts/smoke-server.mjs --dist   # boot the built server bundle headlessly
```

## Acceptance criteria — verification

| #   | Criterion                                                                                   | Result                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm install` + `pnpm dev` → Phaser 4 page: placeholder character on generated tile ground | **Verified headlessly.** Clean-state install (node_modules deleted) OK, 7 s. `pnpm dev` boots all three apps from one command; client serves 200 + manifest 200; Chrome-manual steps below for the visual check |
| 2   | Colyseus server answers on its port                                                         | **Pass.** `/api/health` → 200 `{status,uptimeSeconds,db}`; boot logs `world` room registered; smoke script matchmake probe joins the room (`joinOrCreate/world` ok), also from the built CJS bundle             |
| 3   | Admin shows login page                                                                      | **Verified** served 200 at :5174, built successfully; manual browser check below                                                                                                                                |
| 4   | `pnpm test`                                                                                 | **Pass** — 2 suites, 12 tests                                                                                                                                                                                   |
| 5   | `pnpm typecheck`                                                                            | **Pass** — shared, server, client, admin                                                                                                                                                                        |
| 6   | `pnpm build` / `pnpm lint` / `format:check`                                                 | **Pass** all; server bundle smoke-tested with `node dist/index.cjs`                                                                                                                                             |
| 7   | Postgres via Docker on the Pi                                                               | **Behavior verified, DB currently unreachable** (`homepi:5452` timeout → clear warning, exit 0, health reports `db: "unavailable"`). Correct design behavior; nothing in the game blocks until Phase 2          |

Manual visual checks for the human (headless-verifyable parts above were all scripted):

1. Open http://localhost:5173 — expect: crisp placeholder tiles at zoom 2, capsule character with dark outline + shadow + arrow + idle bob, item icon, badge `Jade Throne — server: online/offline/checking`, console `Jade Throne — Phaser 4.2.1`.
2. Open http://localhost:5174 — expect the themed login card with no console errors.
3. Edit any file — hot reload in all three apps.

## Known issues

- **Dev DB unreachable**: Pi at `homepi:5452` didn't answer during verification — health correctly reports `unavailable`. Set `POSTGRES_HOST`/`POSTGRES_PORT` in `.env` when the Pi is up (name `raspberrypi.local` may fail to resolve on Windows — use the IP).
- **tsx watch + concurrently bug**: `tsx watch` hangs under concurrently's default stdio wrapping (Windows). Server `dev` script uses `node --env-file-if-exists --import tsx --watch` instead (DECISIONS D10). A pnpm/tsx/concurrently upstream report could follow in Phase 1+.
- **Vite config cannot import TS-source workspace packages** (deps are externalized): the client's dev-proxy port keep the literal `2567` with a sync comment; the server uses `DEFAULT_SERVER_PORT` from shared. Revisit if Vite stops externalizing.
- **CI not executed on GitHub**: no remote exists yet; all workflow commands verified locally.
- **Client bundle ~1.6 MB** (Phaser) — code-splitting deferred to Phase 10 (vite chunk-size warning noted at build).
- All visuals are procedural placeholders by design; the client doesn't join the `world` room yet (Phase 1).

## Review notes (task 16, @reviewer pass)

Reviewer verdict: acceptable after fixes. Fixed: silently-broken `maxMessagesPerSecond` room limit (`messagesLimit` was a dead subclass field), zod validation of join options + control-char stripping in display names, per-tile noise offsets + silhouette-clipped char/icon noise, demo map redesigned so grass/dirt/stone/water are all visible at the spawn camera, default-DB-password warning now also covers `.env.example`'s documented password, `HealthPayload` + guard moved to `packages/shared` (with `db` value validation), `DEFAULT_SERVER_PORT` used in server config, `GAME_NAME` used in Boot, manifest validation hardened (`tiles`, `version`) with a client Vitest suite, Preload loader listeners cleaned up, DECISIONS/docs drift corrected, RNG tests pinned to reference values.

Not carried over into code (rejected with reason): validating `parse` of client Vite config through the shared constant — Vite externalizes workspace deps, so the import cannot work (documented as comment instead).
