# Jade Throne

A 2D browser MMORPG: three rival kingdoms, grinding packs of monsters, spirit stones, risky equipment upgrades. The full specification lives in [`GAME_DESIGN.md`](./GAME_DESIGN.md); the development plan for the current phase lives in [`docs/plans/`](./docs/plans/).

## Stack

- pnpm workspaces monorepo, Node.js 24 LTS, TypeScript 5.x strict
- Apps: `apps/client` (Phaser 4 + React 19), `apps/server` (Colyseus 0.17 + Express 5), `apps/admin` (React 19 + Tailwind v4)
- Packages: `packages/shared` (types, constants, formulas — shared by client and server), `packages/data` (JSON game data + Tiled maps)
- Dev Postgres runs in Docker on a Raspberry Pi; the game server needs no Docker (see below)

## Prerequisites

- Node.js 24 LTS (pnpm 12 is pinned via the `packageManager` field)
- A Raspberry Pi (or any Docker host) running the dev Postgres container

## Quickstart

```sh
pnpm install
pnpm dev        # DB reachability check + server :2567 + client :5173 + admin :5174
```

All commands must always work:

| Command                                                                  | Effect                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| `pnpm dev`                                                               | DB check + server + client + admin, with hot reload |
| `pnpm dev:server` / `pnpm dev:client` / `pnpm dev:admin` / `pnpm dev:db` | individual processes                                |
| `pnpm build`                                                             | client + admin vite builds, server esbuild bundle   |
| `pnpm test`                                                              | Vitest suites (root runner)                         |
| `pnpm typecheck`                                                         | `tsc --noEmit` in every package                     |
| `pnpm lint`                                                              | ESLint (flat config)                                |
| `pnpm format` / `pnpm format:check`                                      | Prettier write / check                              |

## Dev database (Raspberry Pi)

Postgres does not run on the dev machine (Docker is not installed there). It runs on the Pi instead:

```sh
cp .env.example .env      # then set POSTGRES_PASSWORD
docker compose up -d
docker compose ps         # should report the container as "healthy"
```

On the dev machine, copy `.env.example` to `.env` and set `POSTGRES_HOST` to the Pi's hostname or IP (use the IP if Windows cannot resolve `raspberrypi.local`). `pnpm dev:db` prints a reachability check, and the server reports DB status at `GET http://localhost:2567/api/health`. One `.env` format works on both machines: the compose file on the Pi only reads the `POSTGRES_*` values.

## Project docs

- `PROGRESS.md` — phase and task checklist
- `DECISIONS.md` — technical decision log
- `docs/plans/phase-0.md` — the current phase plan
- `ASSETS.md` — asset conventions (added later in Phase 0)
