import { REMOTE_INTERP_DELAY_MS, type Vec2 } from "@jadethrone/shared";
import { SampleBuffer } from "./remotes";

/** Client-visible monster fields mirrored from `MonsterState`. */
export interface MonsterData {
  typeId: string;
  name: string;
  level: number;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  moving: boolean;
  isBoss: boolean;
}

export interface MonsterEntity extends MonsterData {
  id: string;
  buffer: SampleBuffer;
}

/**
 * Same buffered interpolation as remote players: every state patch pushes a
 * receipt-timestamped sample and the scene renders `now - 100 ms` behind.
 * Monsters are removed from the registry as soon as the StateView drops them.
 */
export class MonsterRegistry {
  readonly entities = new Map<string, MonsterEntity>();

  sync(monsters: Iterable<[string, MonsterData]>, now: number): { removed: string[] } {
    const seen = new Set<string>();
    for (const [id, data] of monsters) {
      seen.add(id);
      let entity = this.entities.get(id);
      if (!entity) {
        entity = {
          id,
          ...data,
          buffer: new SampleBuffer(32),
        };
        this.entities.set(id, entity);
      } else {
        entity.typeId = data.typeId;
        entity.name = data.name;
        entity.level = data.level;
        entity.facing = data.facing;
        entity.hp = data.hp;
        entity.maxHp = data.maxHp;
        entity.moving = data.moving;
        entity.isBoss = data.isBoss;
      }
      entity.buffer.push(now, data.x, data.y);
    }

    const removed: string[] = [];
    for (const id of this.entities.keys()) {
      if (!seen.has(id)) {
        removed.push(id);
        this.entities.delete(id);
      }
    }
    return { removed };
  }

  renderPosition(entity: MonsterEntity, now: number): Vec2 | null {
    return entity.buffer.sample(now - REMOTE_INTERP_DELAY_MS);
  }

  clear(): void {
    this.entities.clear();
  }
}
