import { MapSchema, Schema, type, view } from "@colyseus/schema";

/**
 * Synchronized room state (schema 4 legacy decorators). Client-visible fields
 * only — private player data (inventory, XP, gold) will later travel through
 * StateView/direct messages (GAME_DESIGN.md §10.2).
 *
 * The `players` collection itself is view-tagged: each client's StateView
 * controls which player instances it receives (interest management), and
 * `view.add/remove` surfaces client-side as `onAdd`/`onRemove`.
 */
export class PlayerState extends Schema {
  @type("string") name!: string;
  @type("string") kingdom!: string;
  /** float32: exact enough (<< 0.01px) for smooth interpolation at map scale. */
  @type("float32") x!: number;
  @type("float32") y!: number;
  /** 0=down, 1=left, 2=right, 3=up (LPC row order). */
  @type("uint8") facing!: number;
  @type("boolean") moving!: boolean;
  /** Highest input sequence the server has applied for this player. */
  @type("uint32") lastSeq!: number;
}

export class WorldState extends Schema {
  // `view: true` inside `@type()` is ignored by the installed schema build;
  // the separate `@view()` decorator is what tags the collection as filtered.
  @view()
  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();
}
