# Phase 10 — Polish, performance and deployment (plan)

Source: `GAME_DESIGN.md` §12 Phase 10 and §10.4/§10.7. Written after reading
`PROGRESS.md`, `DECISIONS.md`, `docs/reports/phase-9.md`, the client/server source
tree and the installed Phaser 4.2.1 / Colyseus 0.17 typings.

## Library API facts verified before planning

- **Phaser 4.2.1 sound:** `scene.sound` is
  `WebAudioSoundManager | HTML5AudioSoundManager | NoAudioSoundManager`; assets load
  with `this.load.audio(key, url | url[])` and play with `this.sound.add(key, config)`.
  Plan uses those and falls back to a WebAudio-synthesised buffer when a file is missing.
- **Colyseus 0.17 tick:** `Room.setSimulationInterval(cb, delay?)` exists. `MapRoom`
  already uses it with `TICK_MS` and `patchRate = 50`.
- **`@colyseus/loadtest`:** not installed today; the Phase-0 plan pinned `0.17.9`.
  Task 10 adds it to the pnpm catalog, with raw `@colyseus/sdk` bots as the fallback
  if its peer range conflicts with the installed SDK.

## 1. What already exists

- Content-complete game: 9 generated maps, 33 monsters / 93 items / 7 stones /
  6 boss groups, channels CH1–CH4, cross-map parties, Spider Cave `DungeonRoom`,
  mounts, teleporter travel, social/PvP/skill-mastery stack. Suite ~116 files / 869 tests.
- Client `Boot → Preload → World` plus a React HUD. Damage-number pool exists;
  monster/remote interpolation reuses one sample buffer; placeholders come from
  `assets/manifest.json`. `Preload` already shows a progress bar and a tips array but
  eagerly loads all 9 maps (~3.4 MB bundle, known Phase-9 issue). Store has
  weather/day-night/shake flags, but **no Settings window, no key rebinding, no
  zoom/name/damage-number settings**. **No audio system** (deliberately deferred, D48).
  No Credits screen (only `assets/CREDITS.md`).
- Server tick is fixed-order (`input → casts → ai → combat → effects → regen →
  respawns → spawns → stones → ground → party → trades → warps`). Admin graceful
  shutdown, countdowns and XP/drop rates exist. Migrations self-apply in the
  background after `listen` (D21). No `SIGTERM` handler, no tick timing, no prod Docker.
- Ops: only the dev `docker-compose.yml` (Postgres on the Pi). No
  `docker-compose.prod.yml`, no `docker/`, no `DEPLOY.md`, no nginx, no `trust proxy`.

## 2. Tasks

1. **Audio manifest + placeholder synth** — `public/assets/manifest.json`,
   `src/assets/audioManifest.ts`, `src/audio/synth.ts`, `ASSETS.md`.
2. **AudioService + Preload wiring** — `src/audio/service.ts`, `scenes/Preload.ts`,
   `scenes/World.ts` hook points.
3. **Wire SFX to existing events** — `World.ts`, blacksmith/shop UI.
4. **Settings window + key rebinding** — `ui/SettingsWindow.tsx`, `ui/store.ts`,
   `ui/Hud.tsx`, shared keymap constants.
5. **Credits screen + loading tips** — `ui/CreditsWindow.tsx`, `Preload.ts`, `ASSETS.md` audit.
6. **Game-feel sweep (§11 leftovers)** — cursor states, window open animation check.
7. **Client perf: lazy maps + pool audit** — `Preload.ts`, `World.ts`, map cache lifecycle.
8. **Server tick instrumentation** — `MapRoom.ts` stage timing, `adminRuntime.ts` status.
9. **Server perf fixes** — only what task 8 proves slow; hoisting/4 Hz passes.
10. **Load test: 150 bots, one channel** — `scripts/verify-phase10-load.mjs`, catalog dep.
11. **Prod Docker + nginx** — `docker-compose.prod.yml`, `docker/*`, nginx config,
    Vite base paths.
12. **Prod server behaviour** — `trust proxy`, migrate-before-listen,
    strict secret validation, SIGTERM graceful shutdown.
13. **`DEPLOY.md` + prod `.env.example`**.
14. **Phase gate** — full verification, `@reviewer`, report, progress/docs updates.

## 3. Hard systems — approach and edge cases

- **Audio:** never block gameplay on decode failure; a missing file becomes a
  synthesised buffer under the same key (same pattern as art placeholders).
  Start the context suspended and resume on the first pointer/key gesture;
  crossfade music on map change; throttle swing SFX; cap overlapping voices.
- **Load / interest:** bots share one channel, so `updateInterest` is worst-case
  O(n²) at 4 Hz (acceptable to ~200). If p95 blows, add a spatial hash before
  touching the tick rate. Never raise `patchRate` to "fix" smoothness — client
  interpolation already covers it.
- **Prod WebSocket proxy:** nginx must forward `Upgrade`/`Connection`, set
  `X-Forwarded-For`; `trust proxy` only when explicitly enabled (IP spoofing would
  defeat rate limits, D28). Single server container; document that replicas need
  Redis presence.
- **Migrations + shutdown:** prod boot migrates then listens (fail fast); dev keeps
  the background self-heal. Shutdown stops joins, warns players through the admin
  bus, saves all rooms, then exits; a SIGTERM during migration waits for it.

## 4. Tests

- Audio service: volume/mute math, missing-file → synth fallback, map→music mapping.
- Settings: localStorage roundtrip, corrupt JSON → defaults, keybind conflict detection.
- Lazy maps: tilemap add/remove per switch, no duplicate cache keys, client/server
  collision-grid parity per map.
- Tick stats: ring-buffer avg/p95 correctness with seeded timings.
- Load script: joins succeed ≥95%, tick p95 < 20 ms over a 60 s window, no
  state corruption spot-check.
- `validate-data.ts`: audio manifest keys + travel graph re-check.

## 5. Acceptance verification

1. **60 FPS / 100 visible entities:** two clients on Valley of Echoes during the bot
   run; F3 overlay ≥ 55 FPS sustained for 60 s with 100 entities visible.
2. **Tick < 20 ms / 150 bots:** `pnpm verify:phase10-load` reads tick p95 from the
   admin status endpoint; PASS only below 20 ms with zero bot crashes.
3. **One-command prod:** `cp .env.example .env && docker compose -f docker-compose.prod.yml up -d --build`
   serves client/admin, migration logs appear, and a graceful stop persists characters.

## 6. Risks

- Synth placeholders sound bad → keep them subtle, default music at 0.4, document
  real asset specs in `ASSETS.md`.
- `@colyseus/loadtest` peer drift → fall back to raw SDK bots.
- Lazy maps could break collision parity → keep consuming the same
  `@jadethrone/data` JSON and add a per-map grid-hash parity test.
- Perf edits in a 6.7k-line `MapRoom` could regress combat → instrumentation and
  hoisting only in task 9, full suite + Phase-9 E2E before the load test.
- nginx path collisions (`/admin`, WS) → explicit location blocks documented in
  `DEPLOY.md`.
- Prod secrets misconfigured → fail fast and name the offending variable, never
  print its value.
