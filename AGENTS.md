# AGENTS.md

You are the sole developer of **Jade Throne**, a 2D browser MMORPG. The full specification is in `GAME_DESIGN.md`. Read it completely before writing any code.

## How you work

1. Work **one phase at a time**, in the order given in `GAME_DESIGN.md` section 12. Never start a later phase early.
2. At the start of every session, read `PROGRESS.md` (create it if missing) to see what is done.
3. Inside a phase, break the work into small tasks. After each task: make sure it type-checks, update `PROGRESS.md`, and commit with git using a clear message.
4. When a phase is complete, verify every acceptance criterion for that phase yourself (run the build, run the tests, start the servers). Then **stop** and write a short report: what was built, how to run it, how to test each acceptance criterion manually, and any known issues. Wait for the human before starting the next phase.
5. Record any non-obvious technical decision in `DECISIONS.md` (one short paragraph each).
6. If something in the spec is ambiguous, choose the simplest option that keeps the game fun, record it in `DECISIONS.md`, and continue. Do not stop to ask unless you are truly blocked.

## Delegating to subagents

You have specialist subagents. Use them; they are more capable than you on these tasks:

- **@architect**: expensive, so call it only for these systems: client prediction/reconciliation/interpolation, monster AI and combat resolution, inventory and item transactions, upgrades, trading. At most once per system, with one clear question. Follow the plan it returns.
- **@debugger**: expensive. Call it only when the same error or failing test survives two of your fix attempts, or when multiplayer behaves wrong (jitter, desync, duplicated items). Do not try a third time yourself.
- **@reviewer**: call it once at the end of every phase, fix what it finds, then write the phase report.
- **@explore**: use it to search the codebase instead of reading many files yourself.

Do routine work (scaffolding, UI components, JSON data, simple features, tests) yourself without delegating. These subagents cost more, so do not call them for easy tasks.

## Library versions: important

Your training data may contain older APIs. This project uses:

- **Phaser 4.x** (not Phaser 3). The API is close to Phaser 3, but check the installed type definitions in `node_modules/phaser/types` before using any API you are not sure about. The Phaser repo ships a `skills/` folder for AI agents; read it if it is available in `node_modules/phaser` or online.
- **Colyseus 0.17** (server `colyseus` / `@colyseus/core`, client `@colyseus/sdk` or `colyseus.js`, whichever the 0.17 docs specify; schema in `@colyseus/schema`). The schema decorators, state callbacks and `StateView` API changed between 0.15, 0.16 and 0.17. Always check the installed `.d.ts` files and https://docs.colyseus.io before writing Colyseus code. Never guess.
- Node.js 24 LTS, TypeScript 5.x strict mode, pnpm workspaces, Vite, React 19, Zustand, Tailwind CSS v4, PostgreSQL, Drizzle ORM, Zod, Vitest.

If a package version you install does not match these, adapt to what is installed and record it in `DECISIONS.md`.

## Code rules

- TypeScript `strict: true` everywhere. No `any` unless commented with a reason.
- **The server is authoritative.** The client only sends intents. The server validates every message with Zod and decides all outcomes (movement, damage, drops, XP, gold, items).
- Game balance values live in `packages/data` (JSON) or `packages/shared/src/formulas.ts`. Never hardcode stats, prices or drop rates inside game logic.
- Code shared by client and server (types, message definitions, movement step, pathfinding, formulas, constants) lives in `packages/shared`.
- Small files with one responsibility each. Prefer plain functions and data over deep class hierarchies.
- Every feature that changes items, gold or XP gets Vitest unit tests.
- Never use the name "Metin2", its real place names, character names or any of its assets. Mechanics are inspired by classic Korean MMORPGs, but everything visible is original.
- Do not commit secrets. Use `.env` files with a committed `.env.example`.

## Commands that must always work

- `pnpm install`
- `pnpm dev` starts Postgres (Docker), the server, the client and the admin panel together
- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
