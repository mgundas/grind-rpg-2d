# Jade Throne — Phase 0 (Foundation) — Builder Handoff

You are the builder. Execute **tasks 1–16 below in order**. This plan was produced on **2026-11-06** after reading `AGENTS.md` and `GAME_DESIGN.md` in full and verifying every version against the npm registry, docs.colyseus.io, Docker Hub and the Phaser repo. Install exactly these versions — do not "upgrade" to newer majors. Any deviation gets a one-paragraph entry in `DECISIONS.md`.

**Read before starting:** `AGENTS.md` (working rules) and `GAME_DESIGN.md` (full spec). Phase 0 only — never start Phase 1 work.

**Per-task loop (from AGENTS.md, applies to every task):** make it typecheck (`pnpm typecheck`; `pnpm test` where relevant) → tick the task off in `PROGRESS.md` → `git add -A && git commit` with the given message. Small, complete, committed.

**Subagent policy (current AGENTS.md):** @architect is only for client prediction/reconciliation/interpolation, monster AI/combat, inventory/item transactions, upgrades, trading — none exist in Phase 0, so **no @architect call this phase**. Run **@reviewer once at the end** (task 16), fix findings, then write the phase report and **stop**.

---

## 1. Phase 0 scope and acceptance

From `GAME_DESIGN.md` §12:

> Monorepo with pnpm workspaces, all apps and packages created, TypeScript strict configs, ESLint/Prettier, Vitest, Docker Compose for Postgres, `.env.example`, `pnpm dev` runs everything with hot reload, `PROGRESS.md`, `DECISIONS.md`, `ASSETS.md` skeletons, asset manifest + procedural placeholder system, CI workflow.

**Acceptance:** `pnpm install && pnpm dev` opens a Phaser 4 page showing a placeholder character on a generated tile ground, the Colyseus server answers on its port, the admin app shows a login page, `pnpm test` and `pnpm typecheck` pass.

Also required by AGENTS.md ("commands that must always work"): `pnpm build` and `pnpm lint` must pass too. Full verification matrix in §10.

## 2. Environment facts (verified on this machine)

- Windows, **pnpm 12.16.1**, **Node 24.11.1**, **git 2.52.0** — all present and sufficient.
- The project directory is **not a git repo yet** → task 1 initializes it.
- **Docker is NOT installed on this machine and will not be.** The dev Postgres runs on the user's **Raspberry Pi** via the root `docker-compose.yml` (§7.3). Nothing in Phase 0 blocks on the DB; it is first *required* in Phase 2.
- `opencode.json` in the repo root is harness config — leave it as-is (commit it).
- Repo currently contains only: `AGENTS.md`, `GAME_DESIGN.md`, `opencode.json`.

## 3. Verified versions and key API facts

### 3.1 Install now (Phase 0)

| Package | Version | Where |
|---|---|---|
| `typescript` | 5.9.3 | root + every workspace package (catalog) |
| `@types/node` | 24.19.2 | root |
| `vitest` | 5.1.0 | root |
| `eslint` | 10.14.0 | root |
| `typescript-eslint` | 8.72.1 | root |
| `eslint-config-prettier` | 10.1.8 | root |
| `eslint-plugin-react-hooks` | 7.1.1 | root |
| `prettier` | 3.9.10 | root |
| `concurrently` | 10.0.6 | root |
| `tsx` | 4.23.15 | root + apps/server |
| `esbuild` | 0.28.2 | apps/server |
| `vite` | 8.3.6 | apps/client, apps/admin |
| `@vitejs/plugin-react` | 6.2.1 | apps/client, apps/admin |
| `react` / `react-dom` | 19.3.1 | apps/client, apps/admin |
| `@types/react` / `@types/react-dom` | 19.3.0 | apps/client, apps/admin |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.4 | apps/admin |
| `zustand` | 5.0.16 | apps/client |
| `phaser` | 4.2.1 | apps/client |
| `@colyseus/sdk` | 0.17.43 | apps/client |
| `colyseus` | 0.17.11 | apps/server |
| `@colyseus/core` | 0.17.56 | apps/server |
| `@colyseus/schema` | 4.0.31 | apps/server |
| `express` | 5.3.0 | apps/server |
| `@types/express` | 5.0.6 | apps/server |
| `pino` | 10.4.0 | apps/server |
| `pg` | 8.23.1 | apps/server (healthz ping only) |
| `@types/pg` | 8.23.1 | apps/server |
| `zod` | 4.6.7 | apps/server (env), packages/shared (message schemas from Phase 1) |
| `@jadethrone/shared` | `workspace:*` | apps/client, apps/server |

### 3.2 Verified for later phases — do NOT install yet

`@colyseus/testing@0.17.11` (P1 room tests) · `@colyseus/monitor@0.17.9` (P5) · `drizzle-orm@0.45.4` + `drizzle-kit@0.31.11` (P2) · `@node-rs/argon2@2.2.2` (P2 — prebuilt binaries, no node-gyp on Windows) · `jsonwebtoken@9.0.3` (P2) · `@colyseus/loadtest@0.17.9` (P10). Postgres image: `postgres:18-alpine` — verified multi-arch on Docker Hub (`linux/386, amd64, arm/v6, arm/v7, arm64/v8`): runs on **every** Raspberry Pi, 32- or 64-bit OS.

### 3.3 Colyseus 0.17 — researched facts (do not rediscover)

Colyseus 0.18 is current; **0.17 is the maintained `legacy-0.17` line** and AGENTS.md pins it. Stay on 0.17.

- Recommended 0.17 server structure: **`app.config.ts` + `defineServer({ rooms, express })` and `defineRoom(MyRoom)` imported from `"colyseus"`** (old `@colyseus/tools` config style is soft-deprecated). The `colyseus` package re-exports everything you need.
- Room style (0.17 breaking changes): `class MyRoom extends Room` **without generics**, `state = new MyState()` as a class property; `onLeave(client, code: number)` (use the `CloseCode` enum; Colyseus reserves close codes 4000–4010); `onMessage` supports multiple handlers per type.
- **`@colyseus/schema@4.0.31` uses legacy decorators** — `@type("number")`, `@type({ map: Player })`, `MapSchema`. The `schema({...})` / `t.number()` builder shown on the docs front page is **schema 5 (0.18) — do not use it**. The server tsconfig must enable `experimentalDecorators: true` and `useDefineForClassFields: false`.
- Client SDK is `@colyseus/sdk@0.17.43` (**not** `colyseus.js`). Not used until Phase 1.
- The `vite` peer dependency on `colyseus` is **optional** — ignore it.
- **Hard rule (AGENTS.md): before writing server code in task 6, read the installed `.d.ts`** — `node_modules/colyseus/build/*.d.ts`, `node_modules/@colyseus/core/build/*.d.ts`, `node_modules/@colyseus/schema/build/index.d.ts` — and confirm `defineServer`'s exact 0.17.11 signature and how to listen. If it differs from the migration guide, fall back to the equally-supported classic pattern: `new Server({ transport: new WebSocketTransport({ app }) })` + `app.listen(port)` (then add `@colyseus/ws-transport@0.17.9` to server deps). Same folder layout either way; record which one you used in DECISIONS.md.
- Reference docs: https://docs.colyseus.io/migrating/0.17 (0.16→0.17 changes), https://docs.colyseus.io/migrating/0.18 (what 0.18 changed — read only to know what NOT to use).

### 3.4 Phaser 4 — researched facts

- `phaser@4.2.1` is the current stable. Types ship at `node_modules/phaser/types/phaser.d.ts`.
- The Phaser repo ships an **AI-agent skills folder** — check `node_modules/phaser/skills/` after install; if absent, the same docs are at https://github.com/phaserjs/phaser/tree/master/skills. Read before client work (task 9): `game-setup-and-config`, `loading-assets`, `scenes`, `tilemaps`, and skim `v4-new-features` + `v3-to-v4-migration`.
- Verified from the skills docs: v4 keeps `pixelArt: true` (auto-sets `antialias:false`, `roundPixels:true`), `Phaser.Scale.RESIZE`, `new Phaser.Game(config)` with a scene array, `Phaser.VERSION`, `game.destroy(true)`.
- Game feel spec (§2 of GAME_DESIGN): camera zoom 2 (integer, configurable) — apply as `this.cameras.main.setZoom(2)` in the World scene, not as canvas zoom.

### 3.5 Toolchain notes

- TypeScript latest is 7.0.2; AGENTS.md pins **5.x** → 5.9.3 (the last 5.x; typescript-eslint 8.72.1 accepts `>=4.8.4 <6.1.0`, ESLint 10 accepted).
- Vite 8.3.6 + plugin-react 6.2.1 (peer `vite ^8`, other peers optional) + vitest 5.1.0 (peers include vite 8, node 24) + `@tailwindcss/vite` 4.3.4 (peers include vite 8) — verified mutually compatible.
- Node 24 supports `--env-file-if-exists=.env` (verify with `node --help`; plain `--env-file=.env` is the fallback and also fine because task 8 guarantees `.env` exists).

## 4. Target repository layout (end state of Phase 0)

```
grind-2d-go/
├─ .github/workflows/ci.yml
├─ .gitignore
├─ .env                    # local only, gitignored (created from .env.example in task 8)
├─ .env.example
├─ .prettierignore
├─ .prettierrc.json
├─ AGENTS.md               # existing — untouched
├─ ASSETS.md               # task 15
├─ DECISIONS.md            # task 1, extended per task
├─ GAME_DESIGN.md          # existing — untouched
├─ PROGRESS.md             # task 1, ticked per task
├─ README.md
├─ docker-compose.yml      # dev Postgres — deployed on the Raspberry Pi (task 8)
├─ eslint.config.js
├─ opencode.json           # existing harness config — commit as-is
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ vitest.config.ts
├─ scripts/
│  └─ dev-db.mjs           # DB reachability check / local compose up (task 8)
├─ apps/
│  ├─ client/              # Phaser 4 + React 19 overlay (Vite)
│  │  ├─ index.html  package.json  tsconfig.json  vite.config.ts
│  │  ├─ public/assets/manifest.json
│  │  └─ src/
│  │     ├─ main.ts              # React root on #overlay + new Phaser.Game
│  │     ├─ game.ts              # GameConfig (AUTO, pixelArt, RESIZE, scenes)
│  │     ├─ scenes/Boot.ts       # fetch manifest, log Phaser.VERSION
│  │     ├─ scenes/Preload.ts    # progress bar + loaderror fallback
│  │     ├─ scenes/World.ts      # demo: tile ground + placeholder character
│  │     ├─ assets/manifest.ts   # manifest types + fetch + validation
│  │     ├─ assets/placeholders.ts  # procedural char/tile/icon generators
│  │     ├─ network/http.ts      # getHealth() via /api proxy
│  │     └─ ui/App.tsx  ui/store.ts  # zustand store + status badge
│  ├─ server/              # Colyseus 0.17 + Express (type: module)
│  │  ├─ package.json  tsconfig.json
│  │  └─ src/
│  │     ├─ app.config.ts        # defineServer + express health route
│  │     ├─ config.ts            # zod-validated env, derives DATABASE_URL
│  │     ├─ logger.ts            # pino
│  │     ├─ routes/health.ts     # GET /api/health
│  │     └─ rooms/
│  │        ├─ WorldRoom.ts
│  │        └─ state/WorldState.ts
│  └─ admin/               # React 19 + Tailwind v4 (Vite)
│     ├─ index.html  package.json  tsconfig.json  vite.config.ts
│     └─ src/ main.tsx  App.tsx  index.css   # login page
└─ packages/
   ├─ shared/
   │  ├─ package.json  tsconfig.json
   │  ├─ src/ index.ts  constants.ts  rng.ts
   │  └─ test/rng.test.ts
   └─ data/
      ├─ package.json  README.md
      └─ maps/.gitkeep
```

Notes: **no `docker/` directory in Phase 0** — the dev compose lives at the repo root (§7.3); `docker/` is created in Phase 10 for the prod compose + Dockerfiles. `packages/shared` and `packages/data` are consumed as **TypeScript source** (`exports: { ".": "./src/index.ts" }`); Vite/tsx/esbuild compile them, so they have no build step. `packages/data` has no `typecheck` script (no TS files yet) — `pnpm -r typecheck` simply skips it.

## 5. Scripts and runtime behavior

Root `package.json` content is in §7.2. Per-app scripts:

- **apps/server**: `"dev": "tsx watch --env-file-if-exists=../../.env src/app.config.ts"` (cwd is `apps/server` when run via `pnpm --filter`, so the root `.env` is `../../.env`; if tsx does not forward the env flag, fall back to `node --env-file-if-exists=../../.env --import tsx --watch src/app.config.ts` — verify by logging the effective config at boot) · `"build": "esbuild src/app.config.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/index.js --external:pg --external:pino"` (if the `node dist/index.js` smoke test fails, extend `--external` rather than fighting the bundler) · `"typecheck": "tsc --noEmit"`.
- **apps/client**: `vite` (config sets port 5173, strictPort, proxy `/api` → `http://localhost:2567`, `envDir: "../.."` so root `.env` `VITE_*` vars resolve) · `vite build` · `vite preview` · `tsc --noEmit`.
- **apps/admin**: same as client but port **5174**, `@tailwindcss/vite` plugin, no proxy.
- **`scripts/dev-db.mjs`** (plain Node, no deps — it exists because Windows PowerShell 5.1 lacks `&&`/`||`, while `&&` inside package.json scripts is fine since pnpm uses cmd.exe):
  - Read `POSTGRES_HOST`/`POSTGRES_PORT` from env (root script runs it as `node --env-file-if-exists=.env scripts/dev-db.mjs`).
  - If host is `localhost`/`127.0.0.1` **and** Docker is available → `docker compose up -d --wait`; if Docker is missing → warn, exit 0.
  - Otherwise (remote host, i.e. the Pi) → TCP connect check (`net.connect`, 1500 ms timeout): print `Postgres at <host>:<port> reachable ✓` or a warning. **Never fatal in Phase 0** — always exit 0.

Ports: server **2567**, client **5173**, admin **5174**.

## 6. Config file policies

- `tsconfig.base.json` (root): `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: "bundler"`, `lib: ["ES2022"]`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `verbatimModuleSyntax`, `esModuleInterop`, `isolatedModules`, `skipLibCheck`, `noEmit`.
  - **apps/server** tsconfig extends it and adds: `experimentalDecorators: true`, `useDefineForClassFields: false` (required by `@colyseus/schema@4` decorators), `types: ["node"]`.
  - **apps/client** / **apps/admin** extend it and add: `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `jsx: "react-jsx"`, `types: ["vite/client"]`.
- `eslint.config.js` (root, flat config, root package is `"type": "module"`): `typescript-eslint` **recommended** (non-type-checked, for speed — note in DECISIONS), applied to `**/*.{ts,tsx}`; `eslint-plugin-react-hooks` recommended rules for React files under `apps/client/src/ui` + `apps/admin` (verify the plugin's flat-config export from its installed README/.d.ts); `eslint-config-prettier` **last**. Ignores: `**/dist/**`, `**/node_modules/**`, `apps/*/public/**`, `coverage/**`. `pnpm lint` = `eslint .`.
- `.prettierrc.json`: `{ "printWidth": 100 }`. `.prettierignore`: `node_modules`, `dist`, `pnpm-lock.yaml`, `coverage`, `.env*`, `AGENTS.md`, `GAME_DESIGN.md` (leave the human-authored spec docs untouched). `pnpm format` writes, `pnpm format:check` verifies.
- `vitest.config.ts` (root): `test: { include: ["packages/*/test/**/*.test.ts"], environment: "node" }`. In Phase 1 this becomes a `projects` config when `@colyseus/testing` server tests arrive — leave a comment saying so.
- `.gitignore`: `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`, `.env`, `.env.*`, `!.env.example`, `.DS_Store`, `Thumbs.db`.

## 7. Verbatim artifacts

### 7.1 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"

catalog:
  typescript: 5.9.3
  "@types/node": 24.19.2
  vitest: 5.1.0
  eslint: 10.14.0
  typescript-eslint: 8.72.1
  eslint-config-prettier: 10.1.8
  eslint-plugin-react-hooks: 7.1.1
  prettier: 3.9.10
  concurrently: 10.0.6
  tsx: 4.23.15
  esbuild: 0.28.2
  vite: 8.3.6
  "@vitejs/plugin-react": 6.2.1
  react: 19.3.1
  react-dom: 19.3.1
  "@types/react": 19.3.0
  "@types/react-dom": 19.3.0
  tailwindcss: 4.3.4
  "@tailwindcss/vite": 4.3.4
  zustand: 5.0.16
  phaser: 4.2.1
  colyseus: 0.17.11
  "@colyseus/core": 0.17.56
  "@colyseus/schema": 4.0.31
  "@colyseus/sdk": 0.17.43
  "@colyseus/ws-transport": 0.17.9   # only needed if the classic Server fallback is used
  express: 5.3.0
  "@types/express": 5.0.6
  pino: 10.4.0
  pg: 8.23.1
  "@types/pg": 8.23.1
  zod: 4.6.7
```

Every `package.json` references these as `"pkg": "catalog:"` so versions are single-sourced (pnpm 12 catalogs).

### 7.2 Root `package.json`

```json
{
  "name": "jade-throne",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.16.1",
  "scripts": {
    "dev": "pnpm dev:db && concurrently -n server,client,admin -c yellow,cyan,magenta \"pnpm --filter @jadethrone/server dev\" \"pnpm --filter @jadethrone/client dev\" \"pnpm --filter @jadethrone/admin dev\"",
    "dev:db": "node --env-file-if-exists=.env scripts/dev-db.mjs",
    "dev:server": "pnpm --filter @jadethrone/server dev",
    "dev:client": "pnpm --filter @jadethrone/client dev",
    "dev:admin": "pnpm --filter @jadethrone/admin dev",
    "build": "pnpm -r build",
    "test": "vitest run",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "concurrently": "catalog:",
    "eslint": "catalog:",
    "eslint-config-prettier": "catalog:",
    "eslint-plugin-react-hooks": "catalog:",
    "prettier": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "typescript-eslint": "catalog:",
    "vitest": "catalog:"
  }
}
```

### 7.3 `docker-compose.yml` (repo root — the user deploys this on the Raspberry Pi)

Root level on purpose: on the Pi, `docker compose up -d` from the repo folder auto-reads the root `.env` with zero flags. This is a deliberate deviation from the spec's `docker/docker-compose.dev.yml` (DECISIONS entry 6).

```yaml
# Jade Throne — development database.
#
# Deploy on the Raspberry Pi (or any Docker host):
#   cp .env.example .env     # then set POSTGRES_PASSWORD
#   docker compose up -d     # .env next to this file is read automatically
#
# Image supports every Pi: arm/v6, arm/v7 (32-bit OS), arm64 (64-bit OS).
# The game server needs no Docker — it reads POSTGRES_HOST / POSTGRES_PORT
# from its own .env on the dev machine and connects over the LAN.

name: jade-throne-dev

services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-jade}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: ${POSTGRES_DB:-jade_throne}
    ports:
      # <port published on the Pi, from .env> : <port inside the container>
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-jade} -d ${POSTGRES_DB:-jade_throne}"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

volumes:
  pgdata:
```

### 7.4 `.env.example`

```ini
# ── Game server (dev machine) ──────────────────────────────
GAME_SERVER_PORT=2567
LOG_LEVEL=info

# ── Postgres dev database (docker-compose.yml runs on the Pi) ─
# On the Pi, compose uses:              POSTGRES_USER/PASSWORD/DB/PORT
# On the dev machine, the server uses:  POSTGRES_HOST/PORT (+ above) to connect
POSTGRES_HOST=raspberrypi.local   # Pi hostname or IP as seen from the dev machine
POSTGRES_PORT=5432                # port the container publishes on the Pi
POSTGRES_USER=jade
POSTGRES_PASSWORD=change-me-dev-only
POSTGRES_DB=jade_throne
# Optional explicit override of the URL built from the parts above (e.g. CI):
# DATABASE_URL=postgres://jade:change-me-dev-only@raspberrypi.local:5432/jade_throne

# ── Phase 2 placeholders (documented early) ────────────────
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=change-me

# ── Client ─────────────────────────────────────────────────
VITE_SERVER_URL=ws://localhost:2567
```

One format works on both machines: compose ignores the game vars on the Pi; the server ignores nothing it needs. `.env` is gitignored; only `.env.example` is committed.

### 7.5 `apps/client/public/assets/manifest.json`

```json
{
  "version": 1,
  "assets": {
    "tileset.village": {
      "path": "tilesets/village.png",
      "placeholder": { "kind": "tileset", "tiles": ["grass", "dirt", "stone", "water", "wall"] }
    },
    "char.body.male": {
      "path": "sprites/char/body-male.png",
      "placeholder": { "kind": "char", "color": "#c89b6a" }
    },
    "icon.item.sword_01": {
      "path": "icons/sword-01.png",
      "placeholder": { "kind": "icon", "rarity": "common", "label": "Sw" }
    }
  }
}
```

All three files are missing on purpose — the placeholder fallback path is exactly what Phase 0 renders. Loader path convention: `this.load.image(key, \`/assets/${entry.path}\`)` (Vite serves `public/` at the root).

### 7.6 `.github/workflows/ci.yml`

```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4        # reads packageManager from package.json
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test
      - run: pnpm build
```

No Postgres service needed in Phase 0 (leave a comment: add a postgres service when DB-touching tests arrive in Phase 2+). There is no GitHub remote yet, so the workflow cannot run in CI — verify its commands locally and note this in the report.

## 8. Asset manifest and procedural placeholder system

The game must be fully playable before any real art exists (GAME_DESIGN §2.1). Design:

1. **Boot** fetches `/assets/manifest.json`, validates it against a TypeScript type (bad manifest → clear on-screen error, never a silent black screen), stores it in `this.game.registry`, and logs `Jade Throne — Phaser ${Phaser.VERSION}` to the console (acceptance check: 4.2.1).
2. **Preload** queues every manifest entry with `this.load.image(key, '/assets/' + entry.path)` while showing a progress bar; a `loaderror` handler records failed keys.
3. After loading completes, `assets/placeholders.ts` generates a **CanvasTexture registered under the same key** for every failed key. From then on, game code only references texture keys — it never knows whether real art exists. Dropping a real file at the path later upgrades the game with zero code changes.
   - *Implementation caution:* if Phaser 4's TextureManager refuses re-registering a failed key after `complete`, generate the placeholder inside the `loaderror` handler instead. Verify against the `loading-assets` skill + `node_modules/phaser/types`.
4. **Generators** (all deterministic — noise seeded via `seedFromString(key)` + `mulberry32` from `@jadethrone/shared`):
   - `tiles`: one canvas strip 32×32 per kind — grass, dirt, stone, water, wall — flat base color + subtle per-pixel value noise (looks good at zoom 2 with `pixelArt`).
   - `char`: 64×64 canvas — rounded capsule with darker outline. Runtime adds the soft elliptical shadow (Graphics, alpha ~0.3), a small facing-direction arrow (Graphics triangle; Phase 0 fixed facing "down"), and the squash-and-stretch idle bob (scaleY 1↔0.94 with slight scaleX compensation, yoyo tween ~700 ms).
   - `icon`: 64×64 rounded square, border in the rarity color (from `RARITY_COLORS` in shared constants), first two letters of the item name centered.
5. **Demo scene (`World.ts`)** proves the whole chain: placeholder tileset → ground (tilemap-from-data-array if `make.tilemap({ data, tileWidth: 32, tileHeight: 32 })` + `addTilesetImage` works against the `tilemaps` skill — fallback: `TileSprite` fills; e.g. 40×30 tiles: grass base, dirt path cross through the middle, water strip along one edge), placeholder character at the spawn point with shadow + arrow + idle bob, one example item icon sprite, `cameras.main.setZoom(2)` + smooth follow of the character.
6. **`ASSETS.md`** (task 15) documents: key namespaces (`char.*`, `mob.*`, `icon.item.*`, `icon.skill.*`, `tileset.*`, `portrait.*`), the Universal LPC sheet spec (64×64 frames; rows in order spellcast 7 / thrust 8 / walk 9 / slash 6 / shoot 13, each with 4 direction rows up/left/down/right, then hurt 1 row × 6 frames; layer order body → legs/pants → feet → torso armor → head/helmet → weapon), tilesets, 64×64 icons (human-generated under `assets/icons/`), placeholder behavior, and the `assets/CREDITS.md` requirement (LPC is CC-BY-SA/GPL; a future credits screen reads it).

## 9. Task list

### Task 1 — Repo init and tracking docs
- `git init`; check `git config user.name/user.email` (ask the user once if unset, set with `git config --local`).
- Create `.gitignore` (§6), `README.md` (short quickstart: prerequisites, `pnpm install`, `pnpm dev`, ports), `PROGRESS.md` ("Phase 0 — Foundation" + this task list as checkboxes), `DECISIONS.md` (header rule + entries from §11 as they land; seed entries 1–5 now).
- Commit: `chore: initialize repository with progress, decisions and readme` (includes the existing AGENTS.md/GAME_DESIGN.md/opencode.json).

### Task 2 — Workspace + toolchain
- `package.json` (§7.2) and `pnpm-workspace.yaml` (§7.1). Run `pnpm install` (no apps exist yet — the globs simply match nothing) and confirm the lockfile is created.
- Commit: `chore: pnpm workspace with pinned toolchain catalog`.

### Task 3 — TS / ESLint / Prettier configs
- `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore` (§6). `pnpm lint` and `pnpm format:check` must run clean on what exists.
- Commit: `build: typescript strict base, eslint flat config and prettier`.

### Task 4 — `packages/shared`
- `package.json` (name `@jadethrone/shared`, `"type": "module"`, `exports`/`types` → `./src/index.ts`, dep `zod: catalog:`), `tsconfig.json` (extends base), `src/constants.ts` (`GAME_NAME`, `TILE_SIZE = 32`, `TICK_HZ = 20`, `TICK_MS = 50`, `DEFAULT_SERVER_PORT = 2567`, `KINGDOMS` with colors — Ember red `#d9453a`, Gale yellow `#e0b526`, Tide blue `#3e8fd9`, fine-tune freely, `RARITY_COLORS` common/fine/rare/legendary, `SPAWN_POINT`), `src/rng.ts` (`mulberry32(seed)` → `() => number` in `[0,1)`, `seedFromString(s)` via FNV-1a; pure, no `Math.random`), `src/index.ts` re-exports, `test/rng.test.ts` (same seed → same sequence; range bounds over ~10k draws; different seeds diverge; `seedFromString` stable and distinct).
- Root `vitest.config.ts` (§6). **`pnpm test` and `pnpm typecheck` green for the first time.**
- Commit: `feat(shared): constants and seeded rng with vitest suite`.

### Task 5 — `packages/data` skeleton
- `package.json` (name `@jadethrone/data`, private, no deps, no scripts), `README.md` describing future contents (`monsters.json`, `items.json`, `dropTables.json`, `skills.json`, `shops.json`, `bonuses.json`, `maps/*.tmj`, JSON schemas, `scripts/validate-data.ts` in Phase 3+), `maps/.gitkeep`.
- Commit: `chore(data): data package skeleton`.

### Task 6 — Server part 1: skeleton + HTTP
- **First read the installed `.d.ts` files** (§3.3 hard rule) and decide `defineServer` vs the classic fallback; record the choice in DECISIONS.md.
- `apps/server/package.json` (`"type": "module"`, deps per §3.1 incl. `@jadethrone/shared`, devDeps `esbuild`/`@types/*`/`tsx`/`typescript`; scripts per §5), `tsconfig.json` (§6 server variant), `src/config.ts` (zod env: `GAME_SERVER_PORT` default 2567, `LOG_LEVEL` default `info`, `POSTGRES_HOST/PORT/USER/PASSWORD/DB` with dev defaults — log a warning when a default password is used, optional `DATABASE_URL` override; derive `databaseUrl` as `DATABASE_URL ?? postgres://user:encodeURIComponent(password)@host:port/db`), `src/logger.ts` (pino), `src/routes/health.ts` (`GET /api/health` → `{ status: "ok", uptimeSeconds, db: "up" | "unavailable" }` via one pg `SELECT 1` with ~1.5 s connect timeout; must never throw), `src/app.config.ts` (`defineServer({ express: app => { app.get("/api/health", health) }, rooms: {} })` — rooms land in task 7 — then listen on `config.port` and log it; log the effective config at boot, which doubles as the env-loading verification).
- Verify: `pnpm dev:server` → `curl http://localhost:2567/api/health` returns 200 JSON; `pnpm --filter @jadethrone/server typecheck`; `pnpm --filter @jadethrone/server build` then `node apps/server/dist/index.js` boots (smoke test the bundle; extend `--external` if it fails).
- Commit: `feat(server): colyseus 0.17 skeleton with express health endpoint`.

### Task 7 — Server part 2: world room + schema state
- `src/rooms/state/WorldState.ts` using **schema 4 decorators** (reference shape):

```ts
import { Schema, type, MapSchema } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") name: string;
  @type("uint16") x: number;
  @type("uint16") y: number;
  @type("string") kingdom: string;
}

export class WorldState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
```

- `src/rooms/WorldRoom.ts`: `class WorldRoom extends Room` (0.17 style, no generics), `maxClients = 200`, `state = new WorldState()`; `onJoin` adds a `PlayerState` at `SPAWN_POINT` (name from `options.name`, sanitized: trim + max 16 chars, default `"Guest"` — the server is authoritative from day one); `onLeave(client, code)` removes the player and logs the close code. No game logic yet.
- Register: `rooms: { world: defineRoom(WorldRoom) }` in `app.config.ts` (or `gameServer.define("world", WorldRoom)` in the fallback shape).
- Verify: server boots, logs the `world` room registration; typecheck + build green.
- Commit: `feat(server): minimal world room with schema state`.

### Task 8 — Docker, env, Pi deployment
- Root `docker-compose.yml` (§7.3 verbatim), `.env.example` (§7.4 verbatim), create the local gitignored `.env` from it (set `POSTGRES_HOST` to the user's Pi host if known, else leave `raspberrypi.local`), `scripts/dev-db.mjs` (§5 behavior), root `dev`/`dev:db` scripts already in §7.2 — this task makes them real.
- README: add a "Dev database (Raspberry Pi)" section — on the Pi: `cp .env.example .env`, set `POSTGRES_PASSWORD` (and `POSTGRES_PORT` if 5432 is taken), `docker compose up -d`, `docker compose ps` → healthy; on the dev machine: `POSTGRES_HOST` points at the Pi, `pnpm dev:db` checks reachability, `/api/health` reports `db: up`. Note: if Windows can't resolve `raspberrypi.local`, put the Pi's IP in `.env`.
- Verify: `pnpm dev:db` prints a clear result for both outcomes (reachable ✓ / warning) and always exits 0. If the user's Pi is already deployed, also confirm healthz `db: "up"` — otherwise note it as a known issue.
- Commit: `build: docker compose dev database with pi deployment and reachability check`.

### Task 9 — Client part 1: Vite + React + Phaser shell
- **First read** `node_modules/phaser/skills/` (or the GitHub equivalent) — `game-setup-and-config`, `loading-assets`, `scenes` — and spot-check `node_modules/phaser/types/phaser.d.ts`.
- `apps/client/package.json` (deps per §3.1; devDeps vite/plugin-react/typescript/@types), `vite.config.ts` (react plugin, port 5173 strictPort, `/api` proxy, `envDir: "../.."`), `tsconfig.json` (§6 client variant), `index.html` (`<div id="game-container"></div>` + `<div id="overlay"></div>`, title "Jade Throne"), `src/main.ts` (React 19 `createRoot` on `#overlay` rendering `<App/>` + `new Phaser.Game(gameConfig)`), `src/game.ts` (`type: Phaser.AUTO`, `pixelArt: true`, `scale: { mode: Phaser.Scale.RESIZE, parent: "game-container", width: "100%", height: "100%" }`, dark background color, `scene: [Boot, Preload, World]`, `title: GAME_NAME`), and trivial `Boot`/`Preload`/`World` scenes so the page runs (World can be a colored background + text for now).
- Verify: `pnpm dev:client` opens http://localhost:5173, console logs `Phaser 4.2.1`, HMR updates on edit, typecheck green.
- Commit: `feat(client): vite react phaser shell with boot scene`.

### Task 10 — Client part 2: manifest + placeholders
- `public/assets/manifest.json` (§7.5 verbatim), `src/assets/manifest.ts` (types: `AssetKind = "char" | "mob" | "icon" | "tileset" | "portrait"`, `AssetEntry { path, placeholder }`, `AssetManifest { version, assets }`; `fetchAssetManifest()` with strict validation and a readable error), `src/assets/placeholders.ts` (§8 generators), real `scenes/Preload.ts` (progress bar; queue all entries; `loaderror` → failed set; generate placeholders for failed keys; then `scene.start("World")`).
- Verify: network tab shows the three 404s, no crash, `this.textures.exists(key)` is true for every manifest key afterward.
- Commit: `feat(client): asset manifest with procedural placeholder fallback`.

### Task 11 — Client part 3: demo world + status overlay
- Real `scenes/World.ts` per §8.5 (tile ground from the placeholder tileset, character + shadow + facing arrow + idle bob, example icon, camera zoom 2 + smooth follow with lerp).
- `src/network/http.ts` (`getHealth(): fetch("/api/health")` → parsed JSON or `null` on error), `src/ui/store.ts` (zustand: `serverOnline: boolean | null`), `src/ui/App.tsx` (absolute top-left badge, `pointer-events: none` on the overlay except the badge: `Jade Throne — server: online/offline/checking` in green/red/gray; poll every 5 s; import `GAME_NAME` from `@jadethrone/shared` — this proves the workspace source-import in the client too).
- Verify: full manual check of acceptance criterion 1 (§10 row 1).
- Commit: `feat(client): placeholder character on generated tile ground with server status overlay`.

### Task 12 — Admin login page
- `apps/admin`: `package.json`, `vite.config.ts` (react + `@tailwindcss/vite` plugins, port 5174 strictPort, `envDir: "../.."`), `tsconfig.json`, `index.html`, `src/index.css` (`@import "tailwindcss";`), `src/main.tsx`, `src/App.tsx` — a centered login card in the game's theme (dark lacquered-wood background, jade-green accents, gold border), email + password fields, a Sign in button, and a small note that the panel itself arrives in Phase 5. Submit is non-functional (`preventDefault`).
- Verify: http://localhost:5174 renders the themed login, no console errors, HMR works.
- Commit: `feat(admin): login page skeleton`.

### Task 13 — Root orchestration
- Wire the root scripts from §7.2 (dev chain, dev:*, build, test, typecheck, lint, format, format:check). Verify `pnpm dev` boots dev-db check + server + client + admin together, hot reload works in all three, and Ctrl+C cleanly kills everything (concurrently handles signal forwarding).
- Then run the full set: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` — all green.
- Commit: `build: root dev orchestration and workspace scripts`.

### Task 14 — CI workflow
- `.github/workflows/ci.yml` (§7.6). No remote exists yet — verify every step's command locally, note in the report that the workflow is untested against GitHub Actions until a remote is added.
- Commit: `ci: github actions workflow`.

### Task 15 — ASSETS.md + credits skeleton
- `ASSETS.md` per §8.6 (namespaces, LPC sheet spec, tilesets, icons, placeholder behavior, licensing note). `apps/client/public/assets/CREDITS.md` placeholder (sections for LPC art, generated icons, audio; all TODO).
- Commit: `docs: asset manifest documentation and credits skeleton`.

### Task 16 — Final verification, review, report
- Run the full acceptance matrix in §10 (including a clean-state `pnpm install`: delete `node_modules`, reinstall from the lockfile).
- Run the **@reviewer** subagent once, fix what it finds.
- Update `PROGRESS.md` to done, write the Phase 0 report: what was built, how to run, how to test each acceptance criterion manually, known issues (§12). Commit: `docs: phase 0 report and progress update`.
- **Stop and wait for the human.** Phase 1 begins with a single @architect consult (client prediction/reconciliation/interpolation for Colyseus 0.17 — exactly the system AGENTS.md reserves it for).

## 10. Acceptance criteria — verification matrix

| # | Criterion | Verification steps |
|---|---|---|
| 1 | `pnpm install && pnpm dev` opens a Phaser 4 page showing a placeholder character on generated tile ground | Clean-state `pnpm install` (exit 0). `pnpm dev` → open **http://localhost:5173**: full-window canvas; 32 px grass/dirt/stone/water placeholder tiles crisp at camera zoom 2; capsule character with dark outline, facing arrow, soft shadow, idle squash-and-stretch bob; one example item icon; badge `Jade Throne — server: online`. Console shows `Phaser 4.2.1` (Boot logs `Phaser.VERSION`). HMR: edit `World.ts` → hot update. |
| 2 | The Colyseus server answers on its port | `curl http://localhost:2567/api/health` → HTTP 200 `{ status: "ok", uptimeSeconds, db: … }`; server log shows listening + `world` room registered. |
| 3 | The admin app shows a login page | **http://localhost:5174** renders the themed login form, no console errors. |
| 4 | `pnpm test` passes | `vitest run` executes the shared rng suite, exit 0. |
| 5 | `pnpm typecheck` passes | `pnpm -r typecheck` green across shared + client + server + admin. |
| 6 | `pnpm build` / `pnpm lint` (AGENTS.md "must always work") | Both exit 0; `pnpm format:check` clean; server bundle smoke-tested with `node apps/server/dist/index.js`. |
| 7 | Postgres via Docker Compose | User deploys `docker-compose.yml` on the Pi → `docker compose ps` healthy. On the dev machine: `pnpm dev:db` prints `Postgres at <host>:<port> reachable ✓` and `/api/health` reports `db: "up"`. If the Pi is not up yet, dev-db warns and everything else still works (DB first required in Phase 2) — report as known issue. |

## 11. DECISIONS.md entries (write during the tasks)

1. **Colyseus 0.17 legacy line** (0.18 is current; AGENTS.md pins 0.17) — `defineServer`/`app.config.ts` structure or the classic fallback actually used, plus schema 4 decorators with `experimentalDecorators` + `useDefineForClassFields: false`.
2. **TypeScript 5.9.3** per AGENTS.md "5.x" (6.x/7.x exist; a future deliberate upgrade, never silent).
3. **pnpm catalog** single-sources every version; `packageManager: pnpm@12.16.1` pins the tool.
4. **Workspace packages consumed as TS source** (`exports` → `src/index.ts`); Vite/tsx/esbuild compile them; no per-package build step.
5. **Express 5.3.0** (@colyseus/monitor 0.17 accepts `>=4.16.0`).
6. **Dev Postgres on the user's Raspberry Pi** via root `docker-compose.yml` — deviation from the spec's `docker/docker-compose.dev.yml` for zero-flag `docker compose up -d` on the Pi; `docker/` deferred to Phase 10; `postgres:18-alpine` multi-arch verified (runs on all Pi models, 32/64-bit).
7. **Server derives `DATABASE_URL` from `POSTGRES_*` parts**; an explicit `DATABASE_URL` wins.
8. **`dev-db.mjs` behavior**: local host + Docker → `compose up -d --wait`; remote host → TCP reachability check; never fatal in Phase 0. Exists as a Node script because PowerShell 5.1 lacks `&&`/`||`.
9. **`pg` only in Phase 0** (healthz ping); Drizzle arrives in Phase 2.
10. **Manifest fallback**: loader `loaderror` → procedural CanvasTexture under the same key; game code never knows whether art is real.
11. **Seeded `mulberry32` in shared** powers placeholder noise and later drop-roll tests (determinism).
12. **Phase 0 demo is a static character** (idle bob only) — movement, prediction, interpolation and room-joining are Phase 1 scope.
13. **Admin login is visual-only**; shadcn/ui deferred to Phase 5.
14. **ESLint 10 flat config + typescript-eslint 8.72 recommended (non-type-checked)** for speed; Prettier runs separately from lint.

## 12. Known issues to expect in the Phase 0 report

- Docker is not installed on the dev machine — by design; the DB runs on the Pi. If the Pi isn't deployed yet, healthz reports `db: "unavailable"` and `pnpm dev:db` warns (nothing blocks until Phase 2).
- Every visual is a procedural placeholder (by design — no art exists yet).
- The client does not join the `world` room yet; the room is a stateless stub (Phase 1).
- The CI workflow has not run against a real GitHub remote (no remote exists yet).
- If Windows mDNS fails to resolve `raspberrypi.local`, put the Pi's IP in `.env` `POSTGRES_HOST`.

---

*End of Phase 0 plan. Produced in plan mode; hand to the builder as-is.*
