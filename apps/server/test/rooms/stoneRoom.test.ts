import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_FIELDS,
  type SelfStatsPayload,
  type StoneDestroyedPayload,
} from "@jadethrone/shared";
import { getStone } from "@jadethrone/data/stones";
import { createGameServer } from "../../src/server";
import type { StoneHit } from "../../src/rooms/combat";
import type { GroundItemRuntime } from "../../src/rooms/groundItems";
import type { MapRoom } from "../../src/rooms/MapRoom";
import type { PlayerRuntime } from "../../src/rooms/playerRuntime";
import type { StoneManager } from "../../src/rooms/stoneManager";
import { createFakeServices, type FakeServices } from "./fakes";

interface RoomInternals {
  applyStoneHits(sessionId: string, hits: readonly StoneHit[], now: number): void;
  stones: StoneManager;
  groundItems: Map<string, GroundItemRuntime>;
  runtimes: Map<string, PlayerRuntime>;
}

function internals(room: MapRoom): RoomInternals {
  return room as unknown as RoomInternals;
}

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2584;

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  fake = createFakeServices();
  const gameServer = createGameServer({
    joinAuthenticator: fake.joinAuthenticator,
    saveCharacter: fake.saveCharacter,
    saveCharacters: fake.saveCharacters,
    loadCharacter: fake.loadCharacter,
    saveSkillState: fake.saveSkillState,
    items: fake.items,
    adminBus: fake.adminBus,
    logChat: fake.logChat,
    logAdminAction: fake.logAdminAction,
    createRandomSource: () => ({ next: () => 0.5 }),
  });
  await gameServer.listen(PORT);
  colyseus = new ColyseusTestServer(gameServer);
}, 30_000);

afterEach(async () => {
  await colyseus.cleanup();
  fake.reset();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("room spirit stones", () => {
  it("spawns waves on thresholds and destroys the stone with XP and drops", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const identity = fake.prepare({ name: "StoneBreaker", map: ROOM_NAME_FIELDS });
    const client = await colyseus.connectTo(room, {
      name: identity.character.name,
      characterId: identity.character.id,
    });
    await room.waitForNextPatch();
    await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));

    const stones = internals(room).stones;
    expect(stones.stones.size).toBeGreaterThan(0);
    const stone = [...stones.stones.values()][0]!;
    const info = getStone(stone.infoId);
    internals(room).runtimes.get(client.sessionId)!.mover.pos = { x: stone.x, y: stone.y };

    const beforeMonsters = room.state.monsters.size;
    internals(room).applyStoneHits(
      client.sessionId,
      [
        {
          target: { kind: "stone", stoneId: stone.stoneId },
          x: stone.x,
          y: stone.y,
          miss: false,
          crit: false,
          damage: Math.floor(info.hp * 0.25),
        },
      ],
      Date.now(),
    );
    expect(room.state.stones.get(stone.stoneId)?.hp).toBeLessThan(info.hp);
    expect(room.state.monsters.size).toBeGreaterThanOrEqual(beforeMonsters + info.waveMin);

    const statsPromise = client.waitForMessage(MSG.selfStats, 2000);
    const destroyedPromise = client.waitForMessage(MSG.stoneDestroyed, 2000);
    const now = Date.now();
    internals(room).applyStoneHits(
      client.sessionId,
      [
        {
          target: { kind: "stone", stoneId: stone.stoneId },
          x: stone.x,
          y: stone.y,
          miss: false,
          crit: false,
          damage: info.hp,
        },
      ],
      now,
    );

    const destroyed = (await destroyedPromise) as StoneDestroyedPayload;
    expect(destroyed.stoneId).toBe(stone.stoneId);
    expect(room.state.stones.has(stone.stoneId)).toBe(false);
    const stats = (await statsPromise) as SelfStatsPayload;
    expect(stats.level > 1 || stats.xp > 0).toBe(true);
    expect(internals(room).groundItems.size).toBeGreaterThan(0);
  });

  it("respawns a destroyed stone through the manager tick", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const stones = internals(room).stones;
    const stone = [...stones.stones.values()][0]!;
    const info = getStone(stone.infoId);
    internals(room).applyStoneHits(
      "session",
      [
        {
          target: { kind: "stone", stoneId: stone.stoneId },
          x: stone.x,
          y: stone.y,
          miss: false,
          crit: false,
          damage: info.hp,
        },
      ],
      Date.now(),
    );
    expect(room.state.stones.has(stone.stoneId)).toBe(false);

    const spawned = stones.tick(Date.now() + info.respawnMaxMs + 1);
    expect(spawned.length).toBeGreaterThan(0);
    (room as unknown as { syncStoneSpawns(stones: typeof spawned): void }).syncStoneSpawns(spawned);
    expect(room.state.stones.size).toBeGreaterThan(0);
  });
});
