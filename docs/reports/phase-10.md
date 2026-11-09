# Phase 10 — Polish, performance and deployment (report)

## What was built

- **Audio.** `assets/audio.json` defines 14 SFX and 5 music keys; every entry
  has a synthesised fallback so no audio file is required. `audio/synth.ts`
  renders deterministic tones/noise and WAV bytes; `audio/service.ts` is a Web
  Audio service with master/music/SFX gains, gesture unlock, per-key
  throttling/polyphony, buffer caching and music crossfades. Boot loads the
  manifest without ever blocking the game. Combat, pickup, gold, level-up,
  death, footsteps, UI clicks, blacksmith/scroll/skill-book results all play
  sounds.
- **Settings.** One persisted `jt.settings.v1` object covers volumes/mute,
  show names, damage numbers, day/night, weather, screen shake, camera zoom and
  key bindings. `ui/keybinds.ts` centralizes 24 rebindable actions with conflict
  detection and deduping; every window, the hotbar and the World scene read it.
  Arrow keys stay a permanent movement alternate. Settings opens with **O** or
  the HUD ⚙ button; key capture uses a window-capture listener so game keys are
  suppressed while rebinding.
- **Credits and loading.** A Credits window reads `assets/CREDITS.md` at runtime
  (procedural placeholders, engines/libraries, TODO slots for real art/audio).
  Loading tips expanded to 16 entries covering channels, dungeons, mounts, PvP,
  skill books, settings and auto-loot.
- **Game feel.** Context cursors (sword / hand / bag), a hurt squash on hit,
  arc-and-bounce item drops, and global button hover/press transitions. The F3/F9
  debug overlay now shows frame time in ms.
- **Client performance.** Tiled maps load as per-map dynamic chunks instead of
  all nine in the initial bundle (`packages/data/src/mapLoader.ts` +
  `apps/client/src/world/mapLoader.ts`). Map switches await the chunk with a 2 s
  retry and cannot strand the scene. A parity test asserts every dynamic import
  equals the static server map byte-for-byte.
- **Server performance.** `TickStats` keeps a 60 s allocation-free ring of tick
  durations and exposes avg/p50/p95/max/overruns through the admin room handle,
  admin bus and `GET /api/admin/server`; the admin Server page renders a table.
  Interest visibility inputs are snapshotted once per pass, and the spawn pass
  reuses a position buffer.
- **Load testing.** `scripts/verify-phase10-load.ts` seeds 150 real SDK bots
  directly in Postgres, joins one channel through real `onAuth`, walks/attacks
  (a third click-to-attack), samples tick stats, asserts joins ≥95 %, movement,
  zero disconnects and p95 < 20 ms, then deletes every `loadbot_*` account.
- **Deployment.** `docker-compose.prod.yml` runs Postgres, the game server and
  nginx (client + `/admin/`); `docker/server.Dockerfile` builds in a multi-stage
  image and runs non-root; `docker/web.Dockerfile` builds both web apps.
  `docker/nginx.conf` proxies `/api`, `/matchmake`, `/colyseus` and room
  WebSockets. `DEPLOY.md` documents one-command start, nginx-proxy-manager,
  backups, updates and troubleshooting. The server bundle also emits
  `dist/seed.cjs` for creating the admin account inside the container.
- **Production behaviour.** `NODE_ENV=production` awaits migrations before
  listening, rejects dev JWT/database/admin placeholders, honours
  `TRUST_PROXY` as a hop count, and saves all rooms on SIGTERM/SIGINT before a
  graceful shutdown.

## How to run

```bash
pnpm install
pnpm dev          # Postgres, server, client, admin
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Targeted checks:

```bash
pnpm verify:phase10-load    # needs pnpm dev + Postgres
node scripts/smoke-server.mjs
docker compose -f docker-compose.prod.yml up -d --build   # production
```

## Acceptance criteria — verification

### 1. 60 FPS with 100 visible entities

1. Start `pnpm dev` and open two browsers on the same map/channel (Valley of
   Echoes has the most open space; Ember Highlands also works).
2. Run `pnpm verify:phase10-load` (or use the bots as moving entity load).
3. Press **F3**: the overlay shows `fps` and `frame` (ms). With 100+ entities in
   view, FPS stays at or above 55 on a mid-range laptop for a sustained minute.
4. Check the damage-number pool and weather emitter do not grow: the pool is
   fixed at 24 and there is one bounded weather emitter.

### 2. Server tick under 20 ms with 150 bots

```bash
pnpm verify:phase10-load
```

The script prints join rate, samples, tick avg/mean p95/worst p95, overruns and
movement, and exits non-zero if joins <95 %, any bot disconnects, fewer than 70 %
of bots moved, or worst p95 ≥ 20 ms. Tick samples come from the server's own
instrumentation after a 65 s warm-up (the ring is 60 s, so join-time ticks have
rolled out).

Measured on the development machine (2026-11-09):

```
join rate         100.0% (150/150)
tick samples      45
players in room   peak 150
tick avg          5.00 ms
tick p95 mean     12.17 ms
tick p95 worst    13.45 ms
overruns (>20ms)  0
bots that left    0
bots moved        143/150
PASS
```

### 3. Production stack starts with one command

```bash
cp .env.example .env      # set POSTGRES_PASSWORD and real JWT secrets
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec server node dist/seed.cjs
```

Open `http://<host>:8080/` (game) and `/admin/` (panel). Migrations run before
the server listens; `docker compose stop` saves characters and sends a shutdown
banner. See `DEPLOY.md`.

## Verification performed (2026-11-09)

- `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.
- Full suite against `jade_throne_test`: **143 files / 1052 tests pass**
  (`TEST_DATABASE_URL` pointing at the test database).
- `pnpm verify:phase10-load`: 150/150 joins, worst p95 13.45 ms, 0 overruns
  above 20 ms, 0 disconnects, 143/150 bots moved — PASS.
- `GAME_SERVER_PORT=2599 node scripts/smoke-server.mjs`: real `tsx` boot with
  `db: "up"` (port 2567 was occupied by the dev server).
- `node dist/seed.cjs`: the production seed bundle runs and is idempotent.
- Client build emits separate per-map chunks; initial JS is ~2.1 MB
  (566 kB gzip) plus 53–262 kB map chunks loaded on demand.
- **Docker was not available in this environment**, so the images were not built
  locally. The compose file, Dockerfiles and nginx config were reviewed against
  the SDK's `/matchmake` and `/<processId>/<roomId>` endpoints; the first real
  build should be done on the deployment host.
- `@reviewer` findings were addressed before this report: load-test warm-up and
  overrun math, TRUST_PROXY hop count, typing guards on all window hotkeys,
  keybind dedupe, window-blur key clearing, map-switch supersession, audio
  retry on failed loads, production seed-password check, DATABASE_URL password
  check, shutdown announcement ordering, nginx room-path regex, web healthcheck,
  and the stray `post.jpg`.

## Known issues / deferred

- FPS is verified manually (F3 overlay); there is no automated frame-time gate.
- Docker image build and the one-command production start require a machine with
  Docker; they are documented and reviewed but unverified here.
- Visited map chunks stay cached in Phaser for the session (all nine total
  ~3.4 MB, now fetched on demand instead of up front). Eviction can follow if
  the map count grows.
- The load test runs ~2 minutes (65 s warm-up + 45 s measure) and needs a dev
  server and database; it refuses to run with `NODE_ENV=production`.
- Bots that stand in mob zones can die during the run; the movement assertion
  compares final positions with their recorded spawn points, so deaths do not
  hide movement.
- One game-server process is assumed; admin live data and room state are
  in-process. Horizontal scaling still needs Redis presence/shared admin bus.
- Real art and audio remain placeholders; `ASSETS.md` and `CREDITS.md` list what
  to drop in.
