# Asset Credits

Jade Throne ships with **procedural placeholder art and audio** so the game is
fully playable before commissioned assets land. Everything currently visible in
the game is generated at runtime by the client code and is original work
created for this project.

## Universal LPC style art (characters, humanoids, some mobs)

- License of real LPC art: CC-BY-SA 3.0 / GPL 3.0 (dual) — attribution and
  share-alike apply.
- Status: no LPC sheets are shipped yet. TODO: list the actual sheet sources,
  generator tools and author links when real sprites are added.

## Generated / original icons

- Current item, skill and UI icons are procedural placeholders drawn by
  `apps/client/src/assets/placeholders.ts` from `packages/data/items.json`.
- TODO: list commissioned icons under `assets/icons/` and their artists.

## Audio

- Current music and sound effects are synthesised placeholders rendered by
  `apps/client/src/audio/synth.ts` from `assets/audio.json`; they are original
  procedural work.
- TODO: list real music/SFX sources, authors and licenses when files land.

## Fonts

- The UI uses the operating system's system-ui font stack; no font files are
  bundled.

## Engine and libraries

- Phaser 4 — MIT License — https://phaser.io
- Colyseus 0.17 — MIT License — https://colyseus.io
- React 19 — MIT License — https://react.dev
- Zustand — MIT License — https://zustand.docs.pmnd.rs
- Node.js, PostgreSQL, Drizzle ORM, Express, Zod, Vitest — MIT/PostgreSQL
  licenses as published by their projects.

## Special thanks

- The Universal LPC Spritesheet community for the art standard and tooling.
- Everyone who playtested the grind loop.
