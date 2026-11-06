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
  @type("string") characterId!: string;
  @type("string") name!: string;
  @type("string") kingdom!: string;
  /** Persisted class id (warrior / assassin / hexblade / mystic). */
  @type("string") classId!: string;
  @type("string") gender!: string;
  @type("uint8") hairStyle!: number;
  @type("uint8") hairColor!: number;
  @type("uint8") level!: number;
  /** float32: exact enough (<< 0.01px) for smooth interpolation at map scale. */
  @type("float32") x!: number;
  @type("float32") y!: number;
  /** 0=down, 1=left, 2=right, 3=up (LPC row order). */
  @type("uint8") facing!: number;
  @type("boolean") moving!: boolean;
  /** Highest input sequence the server has applied for this player. */
  @type("uint32") lastSeq!: number;
  /** Public health/mana (target/party frames); XP and stats stay private. */
  @type("uint16") hp!: number;
  @type("uint16") maxHp!: number;
  @type("uint16") mp!: number;
  @type("uint16") maxMp!: number;
  @type("boolean") dead!: boolean;
  /** Equipped visual layer keys; empty string means that slot is empty. */
  @type("string") weaponLayer!: string;
  @type("string") armorLayer!: string;
  @type("string") helmetLayer!: string;
  @type("string") shieldLayer!: string;
}

/**
 * Client-visible monster. Only fields needed to render, target and interpolate;
 * AI state, home point, group and cooldowns stay in `MonsterRuntime`.
 */
export class MonsterState extends Schema {
  @type("string") typeId!: string;
  @type("string") name!: string;
  @type("uint8") level!: number;
  @type("float32") x!: number;
  @type("float32") y!: number;
  @type("uint8") facing!: number;
  @type("uint16") hp!: number;
  @type("uint16") maxHp!: number;
  @type("boolean") moving!: boolean;
  @type("boolean") isBoss!: boolean;
}

/** A dropped item or a pile of gold (GAME_DESIGN.md §6.3). */
export class GroundItemState extends Schema {
  @type("string") dropId!: string;
  /** "item" | "gold" */
  @type("string") kind!: string;
  /** Empty for gold piles. */
  @type("string") itemId!: string;
  @type("uint32") quantity!: number;
  @type("string") rarity!: string;
  @type("float32") x!: number;
  @type("float32") y!: number;
  @type("string") ownerCharacterId!: string;
  /** Absolute epoch ms when the ownership lock ends (0 = free for all). */
  @type("float64") ownerUntilMs!: number;
  /** Absolute epoch ms; the client can hide a drop before the next patch. */
  @type("float64") despawnAtMs!: number;
}

export class WorldState extends Schema {
  // `view: true` inside `@type()` is ignored by the installed schema build;
  // the separate `@view()` decorator is what tags the collection as filtered.
  @view()
  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();

  @view()
  @type({ map: MonsterState })
  monsters = new MapSchema<MonsterState>();

  @view()
  @type({ map: GroundItemState })
  groundItems = new MapSchema<GroundItemState>();
}
