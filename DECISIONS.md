# Jade Throne — Decisions log

One short paragraph per non-obvious technical decision. Entries are appended as they are made during tasks. This file is seeded with the pre-researched foundation decisions (1–5); 6+ are added during implementation.

## D1 — Stay on the Colyseus 0.17 line

Colyseus 0.18 is the current npm latest, but `AGENTS.md` pins 0.17, which is still maintained under the `legacy-0.17` dist-tag (`colyseus@0.17.11`, `@colyseus/core@0.17.56`, `@colyseus/schema@4.0.x`, `@colyseus/sdk@0.17.x`). We use the 0.17-recommended `app.config.ts` structure (`defineServer` / `defineRoom` imported from `"colyseus"`). To be confirmed during task 6 against the installed typings: the exact `defineServer`/listen signature of 0.17.11; if it differs from the migration guide, the fallback is the equally-supported classic pattern (`new Server({ transport: new WebSocketTransport({ app }) })` + `app.listen`). Also belongs to this decision: `@colyseus/schema@4` uses legacy decorators, so the server tsconfig must set `experimentalDecorators: true` and `useDefineForClassFields: false`.

## D2 — TypeScript pinned to 5.9.3

TypeScript 6.x/7.x exist (7.0.2 is the current npm `latest`), but `AGENTS.md` specifies TypeScript 5.x strict mode, and typescript-eslint 8.72.1 accepts `>=4.8.4 <6.1.0`. We stay on the last 5.x release (5.9.3) and upgrade deliberately later, never silently.

## D3 — Versions single-sourced via pnpm catalogs + build-script allowlist

Every dependency version is pinned once in the `catalog:` block of `pnpm-workspace.yaml`; each `package.json` references versions as `"catalog:"`, so no version can drift between apps. The `packageManager` field pins `pnpm@12.16.1`. pnpm 12 hard-blocks dependency build scripts and fails installation (`strictDepBuilds`) until each package is explicitly allowed — and the old `onlyBuiltDependencies` setting was removed in favor of an `allowBuilds` map in `pnpm-workspace.yaml`. esbuild (transitive dependency of tsx) is the only package with a build script so far and is the single approved entry; future packages with install scripts (e.g. native addons) must be reviewed and added there. Adjustment made during implementation: packages that contain tests (starting with `packages/shared`) also declare `vitest` in their own `devDependencies` so `tsc --noEmit` can resolve the import inside test files — pnpm does not hoist root dependencies into workspace packages.

## D4 — Shared and data packages are consumed as TypeScript source

`@jadethrone/shared` and `@jadethrone/data` have no build step: their `exports`/`types` point at `./src/index.ts`. Vite compiles them in the apps, tsx runs them in the server dev loop, and esbuild bundles them into the server production build. One source of truth, no per-package emit/watch orchestration.

## D5 — Express 5.3.0 for the REST API

The current express major is 5, and `@colyseus/monitor@0.17` accepts `>=4.16.0`, so nothing in the 0.17 toolchain forces express 4. We do not mount the monitor until Phase 5; if compatibility problems appear there, dropping to express 4.22.3 is the recorded fallback.

## D6+ — added during tasks 6–16
