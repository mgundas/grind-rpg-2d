# Jade Throne — Decisions log

One short paragraph per non-obvious technical decision. Entries are appended as they are made during tasks. This file is seeded with the pre-researched foundation decisions (1–5); 6+ are added during implementation.

## D1 — Stay on the Colyseus 0.17 line

Colyseus 0.18 is the current npm latest, but `AGENTS.md` pins 0.17, which is still maintained under the `legacy-0.17` dist-tag (`colyseus@0.17.11`, `@colyseus/core@0.17.56`, `@colyseus/schema@4.0.x`, `@colyseus/sdk@0.17.x`). We use the 0.17-recommended `app.config.ts` structure (`defineServer` / `defineRoom` imported from `"colyseus"`). To be confirmed during task 6 against the installed typings: the exact `defineServer`/listen signature of 0.17.11; if it differs from the migration guide, the fallback is the equally-supported classic pattern (`new Server({ transport: new WebSocketTransport({ app }) })` + `app.listen`). Also belongs to this decision: `@colyseus/schema@4` uses legacy decorators, so the server tsconfig must set `experimentalDecorators: true` and `useDefineForClassFields: false`.

## D2 — TypeScript pinned to 5.9.3

TypeScript 6.x/7.x exist (7.0.2 is the current npm `latest`), but `AGENTS.md` specifies TypeScript 5.x strict mode, and typescript-eslint 8.72.1 accepts `>=4.8.4 <6.1.0`. We stay on the last 5.x release (5.9.3) and upgrade deliberately later, never silently.

## D3 — Versions single-sourced via pnpm catalogs + build-script allowlist

Every dependency version is pinned once in the `catalog:` block of `pnpm-workspace.yaml`; each `package.json` references versions as `"catalog:"`, so no version can drift between apps. The `packageManager` field pins `pnpm@12.16.1`. pnpm 12 hard-blocks dependency build scripts and fails installation (`strictDepBuilds`) until each package is explicitly allowed — and the old `onlyBuiltDependencies` setting was removed in favor of an `allowBuilds` map in `pnpm-workspace.yaml`. esbuild (transitive dependency of tsx, needed for our server build) is explicitly allowed; the optional native accelerator `msgpackr-extract` is explicitly denied — msgpackr falls back to pure JS, which avoids requiring a node-gyp/MSVC toolchain on dev machines and in CI. Adjustment made during implementation: packages that contain tests (starting with `packages/shared`) also declare `vitest` in their own `devDependencies` so `tsc --noEmit` can resolve the import inside test files — pnpm does not hoist root dependencies into workspace packages.

## D4 — Shared and data packages are consumed as TypeScript source

`@jadethrone/shared` and `@jadethrone/data` have no build step: their `exports`/`types` point at `./src/index.ts`. Vite compiles them in the apps, tsx runs them in the server dev loop, and esbuild bundles them into the server production build. One source of truth, no per-package emit/watch orchestration.

## D5 — Express 5.3.0 for the REST API

The current express major is 5, and `@colyseus/monitor@0.17` accepts `>=4.16.0`, so nothing in the 0.17 toolchain forces express 4. We do not mount the monitor until Phase 5; if compatibility problems appear there, dropping to express 4.22.3 is the recorded fallback.

## D6 — The server uses @colyseus/core directly, not the `colyseus` meta bundle

pnpm 12's `blockExoticSubdeps` guard (a supply-chain protection kept enabled) failed installation of the `colyseus` meta bundle because its transitive tree resolves `uWebSockets.js` from a git repository. Reading the installed 0.17.56 typings confirmed the meta was not needed anyway: `defineServer`, `defineRoom`, `Server`, `Room` are all exported from `@colyseus/core`, the default WebSocket transport is auto-detected, and `.d.ts` files resolve cleanly through the package `exports`. We therefore depend on `@colyseus/core@0.17.56` + `@colyseus/schema@0.17-schema-4.0.31` + `@colyseus/ws-transport@0.17.13` directly and import from `@colyseus/core`. This is also a leaner tree: the meta drags in `@colyseus/playground`, redis packages and `@pm2/io` that we do not use. Agent-typing note: `defineServer` in 0.17 returns a non-Server stub only when Colyseus's opt-in devMode is enabled (`setDevMode`/`.devmode.json`) — never in our flow.

## D7 — Verification smoke script

Booting and killing a dev server process reliably on Windows requires killing the whole process tree (`taskkill /T`), which is awkward to script inline. `scripts/smoke-server.mjs` boots the server via tsx, polls `GET /api/health` until it answers, kills the process tree, and exits 0/1 — used to verify every server task headlessly and at the phase-end review.

## D8 — Server production bundle is CJS

`esbuild --format=esm` broke at runtime: Colyseus's CJS dependencies do `require()` on Node builtins (`tty` via `debug`), which esbuild's ESM output does not allow without a `createRequire` banner. The bundle therefore now emits `dist/index.cjs` in CJS format. Consequence: no top-level await in the entrypoint — `server.listen(...)` is chained with `.then()/.catch()` instead.

## D9 — The /api/health DB probe needs a hard deadline and singleflight

Two Windows-specific findings from verifying the endpoint against an unreachable `raspberrypi.local`: (1) pg's `connectionTimeoutMillis` (1.5 s) does not reliably cover a hanging DNS/LLMNR lookup — a dead-cached `.local` name can stall `Client.connect()` well beyond it — so the handler races the DB ping against a 2 s deadline (`db: "unavailable"` on timeout; late results are ignored and the client closes itself). (2) Health endpoints get polled aggressively once monitoring exists, so in-flight pings are singleflighted — one hung ping must not pile up a pg client per request. Also note for test harnesses: the probe client must allow more than the server's own 2 s health deadline, or worst-case responses get aborted client-side.

## D10 — Server dev: `node --watch --import tsx` instead of `tsx watch`

`tsx watch` (4.23.15) hangs at boot under `concurrently` 10's default (non-prefixed, non-raw) stdio wrapping — the process never evaluates the entrypoint and prints nothing after its command line; standalone and under `concurrently --raw` it boots fine, so the trigger is the pipe wrapping. The plan's documented fallback (`node --env-file-if-exists --import tsx --watch`) has no supervisor of its own and mounts the tsx loader inside plain `node --watch` — which boots reliably under concurrently with color prefixes intact and hot-reloads on edit. Adopted for the server `dev` script.

## D10+ — added as work continues
