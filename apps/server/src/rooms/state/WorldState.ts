import { MapSchema, Schema, type } from "@colyseus/schema";

/**
 * Synchronized room state (schema 4 legacy decorators). Client-visible fields
 * only — private player data (inventory, XP, gold) will later travel through
 * StateView/direct messages (GAME_DESIGN.md §10.2).
 */
export class PlayerState extends Schema {
  @type("string") name!: string;
  @type("uint16") x!: number;
  @type("uint16") y!: number;
  @type("string") kingdom!: string;
}

export class WorldState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
