# Jade Throne — Assets

How art is organized, named and consumed by the client. Placeholder assets
keep the game fully playable before real art exists (GAME_DESIGN.md §2.1);
game code always references texture keys and never knows whether the art
behind a key is real or procedural.

## Key namespaces

| Namespace        | Examples                             | Used for                            |
| ---------------- | ------------------------------------ | ----------------------------------- |
| `char.*`         | `char.body.male`, `char.body.female` | Playable character sprite sheets    |
| `mob.*`          | `mob.wolf.alpha`                     | Monster sprite sheets               |
| `icon.item.*`    | `icon.item.sword_01`                 | Item ground icons / inventory icons |
| `icon.skill.*`   | `icon.skill.thrust_01`               | Skill bar icons                     |
| `tileset.*`      | `tileset.village`, `tileset.cave`    | Tiled-compatible terrain sets       |
| `portrait.*`     | `portrait.char.male`                 | Dialog portraits                    |
| `portrait.mob.*` | `portrait.mob.elder`                 | NPC portraits                       |

A key maps to exactly one file path in
`apps/client/public/assets/manifest.json`, together with a placeholder spec
used when the file is missing.

## Universal LPC sprite sheet spec (characters and humanoids)

Same spec as the Universal LPC sprite sheet generator:

- Frame size **64×64**. Character origin: `0.5, ~0.85` (ground at the sprite's
  lower quarter).
- Animation rows, **in this order** (each row = one animation, 4 direction
  rows per animation):
  - spellcast — 7 frames
  - thrust — 8 frames (3-frame hold repeats after)
  - walk — 9 frames
  - slash — 6 frames
  - shoot — 13 frames
  - each animation's directions ordered **up, left, down, right** top to
    bottom
  - hurt — 1 row × 6 frames, at the bottom
- Layer order (a character sheet is composited from these layer sheets,
  paintable in-game): body → legs/pants → feet → torso armor → head/helmet →
  weapon.
- Corner rotation notes: walk/spellcast/thrust/shoot/slash/hurt are
  counter-clockwise; shoot animation is clockwise.

The `char.*`/`mob.*` manifest entries point at skin-only body sheets in
Phase 0; compositing support arrives with the Phase 3+ sprite pipeline.

## Tilesets

- Tile size **32×32** (`TILE_SIZE` in `@jadethrone/shared`), no margin or
  spacing in placeholder strips.
- Maps under `packages/data/maps/*.tmj` (Tiled 1.9+ JSON) reference tilesets
  by file; terrain variants (grass, dirt, stone, water, wall) keep stable
  per-set GIDs documented inline in the set.

## Icons

- **64×64**, transparent background, item silhouette fills the frame.
- Human-generated icons live under `apps/client/public/assets/icons/` —
  they are the one asset class the placeholder system does not try to fake
  in final art, only during development.
- Gold border color encodes rarity (`RARITY_COLORS` in
  `@jadethrone/shared`): common `#b8c0c8`, fine `#4a90d9`, rare `#9b59d0`,
  legendary `#d4a017`.

## Placeholder behavior

`scenes/Preload.ts` queues every manifest entry; files that fail to load get
a deterministic procedural `CanvasTexture` registered **under the same key**
(`assets/placeholders.ts`; noise seeded per key via `mulberry32` +
`seedFromString`). From that point the game only references texture keys.

- `tileset` placeholder: N-tile horizontal strip, one 32×32 tile per kind in
  manifest order (flat color + subtle per-pixel value noise).
- `char`/`mob` placeholder: 64×64 rounded capsule with darker outline and
  head hint.
- `icon` placeholder: 64×64 rounded square, border in the rarity color,
  first two letters of the label centered.
- `portrait` placeholder: tinted square with a generic label.

### Layered character placeholders (Phase 2)

The world and the character-select preview no longer use the single
`char.body.male` texture. `apps/client/src/assets/characterArt.ts` paints a
64x64 composite from the persisted appearance (`classId`, `gender`,
`hairStyle`, `hairColor`) in layers: legs → torso/class outfit → belt → arms →
head → hair. The class colours come from `packages/data/classes.json`. Textures
are cached under `char.gen.<class>.<gender>.<hairStyle>.<hairColor>` so real LPC
art can replace the procedural painter under the same key later; no game code
needs to change.

Dropping a real file at the manifest path (or editing `manifest.json`)
upgrades the game with zero code changes; the silent-failure rule is
"missing file → placeholder, never a black screen" (bad manifest → readable
on-screen error text).

## Licensing

- Universal LPC art is **CC-BY-SA 3.0 / GPL 3.0** dual-licensed. Any game
  built on LPC assets must carry attribution — `apps/client/public/assets/CREDITS.md`
  is committed with the art, and a future credits screen reads from it at
  runtime (Phase 10).
- Original art commissioned for Jade Throne is licensed for the game; per-
  contributor attribution also goes into CREDITS.md.
- Audio credits: same rules, same file.
