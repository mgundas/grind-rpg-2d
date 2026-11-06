import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  TICK_MS,
  createMover,
  dir8Towards,
  isWalkableAt,
  stepMover,
  type CombatEventPayload,
  type InputMessage,
  type MonsterDiedPayload,
  type SelfStatsPayload,
  type TargetClearedPayload,
  type WarpPayload,
} from "@jadethrone/shared";
import { FIELDS_SPAWN, VILLAGE_SPAWN } from "@jadethrone/data";
import { createGameServer } from "../../src/server";
import { loadMapAssets } from "../../src/maps/mapRegistry";
import { issueWarpToken } from "../../src/rooms/warpTokens";
import { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The SDK's `send` is typed against declared room messages; ours are strings. */
function sendInput(client: unknown, message: InputMessage): void {
  (client as { send: (type: string, payload: unknown) => void }).send(MSG.input, message);
}

function sendChat(client: unknown, text: string): void {
  (client as { send: (type: string, payload: unknown) => void }).send(MSG.chat, { text });
}

/** What the SDK client actually received through its StateView. */
function clientPlayers(client: unknown): { has: (key: string) => boolean } | undefined {
  return (client as { state?: { players?: { has: (key: string) => boolean } } }).state?.players;
}

interface ClientMonster {
  typeId: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  isBoss: boolean;
}

function clientMonsters(client: unknown): Map<string, ClientMonster> | undefined {
  return (client as { state?: { monsters?: Map<string, ClientMonster> } }).state?.monsters;
}

function sendAttack(client: unknown, dir?: number): void {
  (client as { send: (type: string, payload: unknown) => void }).send(
    MSG.attack,
    dir === undefined ? {} : { dir },
  );
}

function sendRespawn(client: unknown, option: "here" | "town"): void {
  (client as { send: (type: string, payload: unknown) => void }).send(MSG.respawn, { option });
}

function sendSetTarget(client: unknown, monsterId: string): void {
  (client as { send: (type: string, payload: unknown) => void }).send(MSG.setTarget, {
    monsterId,
  });
}

function sendAllocStat(client: unknown, stat: "vit" | "int" | "str" | "dex"): void {
  (client as { send: (type: string, payload: unknown) => void }).send(MSG.allocStat, { stat });
}

function captureMessages(client: unknown, type: string): unknown[] {
  const messages: unknown[] = [];
  (client as { onMessage: (type: string, callback: (payload: unknown) => void) => void }).onMessage(
    type,
    (payload) => messages.push(payload),
  );
  return messages;
}

interface MonsterRuntimeProbe {
  hp: number;
  ai: string;
  targetSessionId: string | null;
  mover: { pos: { x: number; y: number } };
}

function monsterRuntimes(room: MapRoom): Map<string, MonsterRuntimeProbe> {
  return (room as unknown as { monsterRuntimes: Map<string, MonsterRuntimeProbe> }).monsterRuntimes;
}

interface PlayerRuntimeProbe {
  dead: boolean;
  diedAtMs: number;
  dirty: boolean;
  progression: {
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    level: number;
    xp: number;
    statPoints: number;
    stats: { vit: number; int: number; str: number; dex: number };
  };
}

function playerRuntimeOf(room: MapRoom, sessionId: string): PlayerRuntimeProbe {
  return (room as unknown as { runtimes: Map<string, PlayerRuntimeProbe> }).runtimes.get(
    sessionId,
  )!;
}

function nearestMonsterId(room: MapRoom, sessionId: string): string {
  const player = room.state.players.get(sessionId)!;
  let bestId = "";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [id, monster] of room.state.monsters) {
    const dx = monster.x - player.x;
    const dy = monster.y - player.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = id;
    }
  }
  return bestId;
}

interface RuntimeProbe {
  pathComputations: number;
  droppedInputs: number;
}

function runtimeOf(room: MapRoom, sessionId: string): RuntimeProbe {
  const runtimes = (room as unknown as { runtimes: Map<string, RuntimeProbe> }).runtimes;
  const runtime = runtimes.get(sessionId);
  if (!runtime) {
    throw new Error(`missing runtime for ${sessionId}`);
  }
  return runtime;
}

beforeAll(async () => {
  fake = createFakeServices();
  colyseus = await boot(
    createGameServer({
      joinAuthenticator: fake.joinAuthenticator,
      saveCharacter: fake.saveCharacter,
      saveCharacters: fake.saveCharacters,
      // Hit, neutral damage roll, no crit; cycles per target. AI wander is not
      // due during these tests, so combat draws stay predictable.
      createRandomSource: () => {
        const values = [0, 0.5, 0.9];
        let index = 0;
        return { next: () => values[index++ % values.length]! };
      },
      combatTuning: { respawnHereDelayMs: 300, respawnHereHpFraction: 0.3 },
    }),
  );
}, 30_000);

afterEach(async () => {
  await colyseus.cleanup();
  fake.reset();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("MapRoom join", () => {
  it("spawns at the authenticated character's village position", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Alice" });
    await room.waitForNextPatch();

    const player = room.state.players.get(client.sessionId);
    expect(player).toBeDefined();
    expect(player!.characterId.length).toBeGreaterThan(0);
    expect(player!.name).toBe("Alice");
    expect(player!.kingdom).toBe("ember");
    expect(player!.classId).toBe("warrior");
    expect(player!.gender).toBe("male");
    expect(player!.hairStyle).toBe(0);
    expect(player!.hairColor).toBe(0);
    expect(player!.level).toBe(1);
    expect(player!.x).toBeCloseTo(VILLAGE_SPAWN.x, 5);
    expect(player!.y).toBeCloseTo(VILLAGE_SPAWN.y, 5);
    expect(player!.facing).toBe(0); // down
    expect(player!.moving).toBe(false);
    expect(player!.lastSeq).toBe(0);
  });

  it("sees its own player through the StateView", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Viewer" });
    await room.waitForNextPatch();

    const serverClient = room.clients.find((candidate) => candidate.sessionId === client.sessionId);
    const player = room.state.players.get(client.sessionId);
    expect(serverClient?.view?.has(player!)).toBe(true);
    expect(clientPlayers(client)?.has(client.sessionId)).toBe(true);
  });

  it("lets two players see each other", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const bob = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();

    expect(room.state.players.size).toBe(2);
    const aliceState = room.state.players.get(alice.sessionId)!;
    const bobState = room.state.players.get(bob.sessionId)!;
    const aliceServer = room.clients.find((candidate) => candidate.sessionId === alice.sessionId)!;
    const bobServer = room.clients.find((candidate) => candidate.sessionId === bob.sessionId)!;
    expect(aliceServer.view?.has(bobState)).toBe(true);
    expect(bobServer.view?.has(aliceState)).toBe(true);
    // The wire matters, not only the server-side view.
    expect(clientPlayers(alice)?.has(bob.sessionId)).toBe(true);
    expect(clientPlayers(bob)?.has(alice.sessionId)).toBe(true);
  });

  it("spawns on the fields at their own spawn point", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, {
      name: "Scout",
      map: ROOM_NAME_FIELDS,
    });
    await room.waitForNextPatch();

    const player = room.state.players.get(client.sessionId)!;
    expect(player.x).toBeCloseTo(FIELDS_SPAWN.x, 5);
    expect(player.y).toBeCloseTo(FIELDS_SPAWN.y, 5);
  });

  it("ignores client-supplied spawn positions", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, {
      name: "Cheater",
      x: VILLAGE_SPAWN.x + 500,
      y: VILLAGE_SPAWN.y,
    });
    await room.waitForNextPatch();

    const player = room.state.players.get(client.sessionId)!;
    expect(player.x).toBeCloseTo(VILLAGE_SPAWN.x, 5);
    expect(player.y).toBeCloseTo(VILLAGE_SPAWN.y, 5);
  });

  it("uses the authenticated name, kingdom and appearance", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, {
      name: "Yuna",
      kingdom: "tide",
      classId: "assassin",
      gender: "female",
      hairStyle: 1,
      hairColor: 2,
      level: 7,
    });
    await room.waitForNextPatch();

    const player = room.state.players.get(client.sessionId)!;
    expect(player.name).toBe("Yuna");
    expect(player.kingdom).toBe("tide");
    expect(player.classId).toBe("assassin");
    expect(player.gender).toBe("female");
    expect(player.hairStyle).toBe(1);
    expect(player.hairColor).toBe(2);
    expect(player.level).toBe(7);
  });

  it("spawns at the saved position and falls back when it is not walkable", async () => {
    const assets = loadMapAssets(ROOM_NAME_VILLAGE);
    let savedX = VILLAGE_SPAWN.x;
    for (let offset = 32; offset <= 160; offset += 32) {
      if (isWalkableAt(assets.grid, VILLAGE_SPAWN.x + offset, VILLAGE_SPAWN.y)) {
        savedX = VILLAGE_SPAWN.x + offset;
        break;
      }
    }
    const saved = fake.prepare({ name: "Saved", spawnX: savedX, spawnY: VILLAGE_SPAWN.y });

    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, {
      characterId: saved.character.id,
      name: "Saved",
    });
    await room.waitForNextPatch();
    const player = room.state.players.get(client.sessionId)!;
    expect(player.x).toBeCloseTo(savedX, 1);
    expect(player.y).toBeCloseTo(VILLAGE_SPAWN.y, 1);

    const invalid = fake.prepare({ name: "Stuck", spawnX: 1, spawnY: 1 });
    const second = await colyseus.connectTo(room, {
      characterId: invalid.character.id,
      name: "Stuck",
    });
    await room.waitForNextPatch();
    const stuck = room.state.players.get(second.sessionId)!;
    expect(stuck.x).toBeCloseTo(VILLAGE_SPAWN.x, 1);
    expect(stuck.y).toBeCloseTo(VILLAGE_SPAWN.y, 1);
  });

  it("removes the player from state on leave", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Leaver" });
    await room.waitForNextPatch();
    expect(room.state.players.size).toBe(1);

    await client.leave();
    // No clients remain, so no patch is broadcast — poll the authoritative
    // server state instead of waiting for a patch.
    await waitUntil(() => room.state.players.size === 0);
    expect(room.state.players.size).toBe(0);
  });

  it("saves the authoritative position when a moved player leaves", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Saver" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;
    const characterId = room.state.players.get(sessionId)!.characterId;

    sendInput(client, { seq: 1, kind: "dir", dir: 0 });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 1);
    sendInput(client, { seq: 2, kind: "none" });
    await waitUntil(() => room.state.players.get(sessionId)!.moving === false);
    const before = {
      x: room.state.players.get(sessionId)!.x,
      y: room.state.players.get(sessionId)!.y,
    };

    await client.leave();
    await waitUntil(() => fake.saved.length > 0, 3000);

    const last = fake.saved.at(-1)!;
    expect(last.characterId).toBe(characterId);
    expect(last.mapId).toBe(ROOM_NAME_VILLAGE);
    expect(last.x).toBeCloseTo(before.x, 1);
    expect(last.y).toBeCloseTo(before.y, 1);
  });

  it("autosaves dirty players in one batch", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const bob = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();

    sendInput(alice, { seq: 1, kind: "dir", dir: 0 });
    sendInput(bob, { seq: 1, kind: "dir", dir: 2 });
    await waitUntil(() => room.state.players.get(alice.sessionId)!.lastSeq === 1);
    await waitUntil(() => room.state.players.get(bob.sessionId)!.lastSeq === 1);

    const autosave = (room as unknown as { autosave: () => Promise<void> }).autosave;
    await autosave.call(room);

    expect(fake.saveCharacter).toHaveBeenCalledTimes(2);
    const savedIds = fake.saved.map((save) => save.characterId);
    expect(savedIds).toContain(room.state.players.get(alice.sessionId)!.characterId);
    expect(savedIds).toContain(room.state.players.get(bob.sessionId)!.characterId);
  });

  it("kicks the previous session when the same character joins again", async () => {
    const identity = fake.prepare({ name: "Twin" });
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await colyseus.connectTo(room, {
      characterId: identity.character.id,
      name: "Twin",
    });
    await room.waitForNextPatch();

    const left = new Promise<number>((resolve) => {
      first.onLeave((code) => resolve(code));
    });
    const second = await colyseus.connectTo(room, {
      characterId: identity.character.id,
      name: "Twin",
    });
    await room.waitForNextPatch();

    const code = await Promise.race([left, sleep(3000).then(() => -1)]);
    expect(code).toBe(4100);
    expect(room.state.players.has(second.sessionId)).toBe(true);
    expect(room.state.players.has(first.sessionId)).toBe(false);
  });

  it("rejects a join whose authentication fails", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    await expect(colyseus.connectTo(room, { name: "__reject__" })).rejects.toBeTruthy();
    expect(room.state.players.size).toBe(0);
  });
});

describe("MapRoom movement", () => {
  it("moves, acks the input sequence and stops on none", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Walker" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;
    const startX = room.state.players.get(sessionId)!.x;

    sendInput(client, { seq: 1, kind: "dir", dir: 0 });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 1);
    expect(room.state.players.get(sessionId)!.x).toBeGreaterThan(startX);

    sendInput(client, { seq: 2, kind: "none" });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 2);
    await waitUntil(() => room.state.players.get(sessionId)!.moving === false);

    const stoppedX = room.state.players.get(sessionId)!.x;
    await sleep(150);
    expect(room.state.players.get(sessionId)!.x).toBe(stoppedX);
  });

  it("ignores stale and duplicate sequences", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Stale" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;

    sendInput(client, { seq: 1, kind: "dir", dir: 0 });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 1);
    sendInput(client, { seq: 2, kind: "none" });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 2);
    await waitUntil(() => room.state.players.get(sessionId)!.moving === false);
    const stoppedX = room.state.players.get(sessionId)!.x;

    // Replaying old sequences must not move the player again.
    sendInput(client, { seq: 1, kind: "dir", dir: 0 });
    sendInput(client, { seq: 2, kind: "dir", dir: 0 });
    await sleep(150);
    expect(room.state.players.get(sessionId)!.x).toBe(stoppedX);
  });

  it("stops at a wall instead of clipping through it", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const token = issueWarpToken(ROOM_NAME_VILLAGE, VILLAGE_SPAWN.x, 80);
    const client = await colyseus.connectTo(room, { name: "Wall", warpToken: token });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;

    for (let seq = 1; seq <= 6; seq++) {
      sendInput(client, { seq, kind: "dir", dir: 6 }); // north
    }
    sendInput(client, { seq: 7, kind: "none" });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 7);
    await waitUntil(() => room.state.players.get(sessionId)!.moving === false);

    const player = room.state.players.get(sessionId)!;
    // Border ring starts at y=64; the body is 12px tall (half 6), so the
    // centre stops at y=70.
    expect(player.y).toBeCloseTo(70, 3);
    const grid = (room as unknown as { assets: { grid: Parameters<typeof isWalkableAt>[0] } })
      .assets.grid;
    expect(isWalkableAt(grid, player.x, player.y)).toBe(true);
  });

  it("follows a click-to-move path to its exact target", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Clicker" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;
    const target = { x: VILLAGE_SPAWN.x + 96, y: VILLAGE_SPAWN.y };

    sendInput(client, { seq: 1, kind: "path", x: target.x, y: target.y });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 1);
    await waitUntil(() => {
      const player = room.state.players.get(sessionId)!;
      return !player.moving && Math.abs(player.x - target.x) < 4;
    }, 3000);

    const player = room.state.players.get(sessionId)!;
    expect(player.x).toBeCloseTo(target.x, 0);
    expect(player.y).toBeCloseTo(target.y, 0);
  });

  it("keeps the last direction for up to three grace ticks after input stops", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Stopper" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;

    sendInput(client, { seq: 1, kind: "dir", dir: 0 });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 1);
    const afterAckX = room.state.players.get(sessionId)!.x;
    await sleep(300);
    const settled = room.state.players.get(sessionId)!;
    expect(settled.moving).toBe(false);
    const graceDistance = settled.x - afterAckX;
    expect(graceDistance).toBeGreaterThan(0);
    expect(graceDistance).toBeLessThanOrEqual(3 * 12 + 0.001);
    const settledX = settled.x;
    await sleep(150);
    expect(room.state.players.get(sessionId)!.x).toBe(settledX);
  });

  it("stops immediately on an explicit none", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Stopper" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;

    sendInput(client, { seq: 1, kind: "dir", dir: 0 });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 1);
    sendInput(client, { seq: 2, kind: "none" });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 2);
    await waitUntil(() => room.state.players.get(sessionId)!.moving === false);
    const stoppedX = room.state.players.get(sessionId)!.x;
    await sleep(200);
    expect(room.state.players.get(sessionId)!.x).toBe(stoppedX);
  });

  it("caps batched input to one step per tick", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Burst" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;
    const startX = room.state.players.get(sessionId)!.x;

    // A full second of movement (20 intents) delivered all at once must not
    // move faster than 20 ticks' worth; it should take ~1 s to apply.
    for (let seq = 1; seq <= 20; seq++) {
      sendInput(client, { seq, kind: "dir", dir: 0 });
    }
    await sleep(600);
    const moved = room.state.players.get(sessionId)!.x - startX;
    expect(moved).toBeLessThanOrEqual(12 * 10 + 0.001);
    expect(moved).toBeGreaterThan(0);
  });

  it("drops the oldest queued inputs when a client floods the queue", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Flooder" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;

    for (let seq = 1; seq <= 20; seq++) {
      sendInput(client, { seq, kind: "dir", dir: 0 });
    }
    await sleep(150);
    expect(runtimeOf(room, sessionId).droppedInputs).toBeGreaterThan(0);
    // The session must still be healthy and processing the newest inputs.
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq >= 8);
  });

  it("does not rerun A* for a repeated unreachable target", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Spammer" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;
    const runtime = runtimeOf(room, sessionId);
    const unreachable = { x: 60000, y: 60000 };

    for (let seq = 1; seq <= 10; seq++) {
      sendInput(client, { seq, kind: "path", ...unreachable });
    }
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq >= 10);
    expect(runtime.pathComputations).toBe(1);
  });

  it("rate-limits rapid click-to-move retargets", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Jitter" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;
    const runtime = runtimeOf(room, sessionId);

    sendInput(client, { seq: 1, kind: "path", x: 60000, y: 60000 });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 1);
    // A different goal tile, applied on the next 50 ms tick: inside the
    // 100 ms retarget window, so it must not run a second A*.
    sendInput(client, { seq: 2, kind: "path", x: 50000, y: 50000 });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 2);
    expect(runtime.pathComputations).toBe(1);
  });

  it("matches the shared step exactly for a scripted input sequence", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Parity" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;
    const { grid } = loadMapAssets(ROOM_NAME_VILLAGE);

    let expected = createMover(VILLAGE_SPAWN);
    const steps = [0, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2] as const;
    for (let index = 0; index < steps.length; index++) {
      const seq = index + 1;
      const dir = steps[index]!;
      sendInput(client, { seq, kind: "dir", dir });
      await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === seq);
      expected = stepMover(expected, { kind: "dir", dir }, grid, TICK_MS);
    }

    const player = room.state.players.get(sessionId)!;
    expect(player.x).toBeCloseTo(expected.pos.x, 4);
    expect(player.y).toBeCloseTo(expected.pos.y, 4);
  });

  it("survives an invalid input payload", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Cheater" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;

    (client as unknown as { send: (type: string, payload: unknown) => void }).send(MSG.input, {
      seq: -1,
      kind: "dir",
      dir: 0,
    });
    await sleep(100);
    expect(room.state.players.has(sessionId)).toBe(true);

    sendInput(client, { seq: 1, kind: "dir", dir: 0 });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 1);
  });
});

describe("MapRoom chat", () => {
  it("delivers local chat to nearby players, including the sender", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const bob = await colyseus.connectTo(room, {
      name: "Bob",
      x: VILLAGE_SPAWN.x + 64,
      y: VILLAGE_SPAWN.y,
    });
    await room.waitForNextPatch();

    const received = alice.waitForMessage(MSG.chatMsg);
    let bobEcho = false;
    bob.onMessage(MSG.chatMsg, () => {
      bobEcho = true;
    });
    sendChat(bob, "hello village");

    const message = (await received) as { from: string; name: string; text: string };
    expect(message.from).toBe(bob.sessionId);
    expect(message.name).toBe("Bob");
    expect(message.text).toBe("hello village");
    await sleep(50);
    expect(bobEcho).toBe(true);
  });

  it("does not deliver chat beyond the local range", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const farToken = issueWarpToken(ROOM_NAME_VILLAGE, VILLAGE_SPAWN.x + 1000, VILLAGE_SPAWN.y);
    const bob = await colyseus.connectTo(room, { name: "Bob", warpToken: farToken });
    await room.waitForNextPatch();

    let received = false;
    alice.onMessage(MSG.chatMsg, () => {
      received = true;
    });
    sendChat(bob, "too far");
    await sleep(150);
    expect(received).toBe(false);
  });

  it("enforces a per-sender chat cooldown", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const bob = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();

    const first = alice.waitForMessage(MSG.chatMsg);
    sendChat(bob, "one");
    await first;

    let second = false;
    alice.onMessage(MSG.chatMsg, () => {
      second = true;
    });
    sendChat(bob, "two");
    await sleep(150);
    expect(second).toBe(false);

    // Exactly one cooldown later the sender is allowed again.
    await sleep(1000);
    const third = alice.waitForMessage(MSG.chatMsg, 1000);
    sendChat(bob, "three");
    expect(((await third) as { text: string }).text).toBe("three");
  });

  it("drops invalid chat payloads without killing the session", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const bob = await colyseus.connectTo(room, { name: "Bob" });
    await room.waitForNextPatch();

    (bob as unknown as { send: (type: string, payload: unknown) => void }).send(MSG.chat, {
      text: "x".repeat(500),
    });
    await sleep(100);
    expect(room.state.players.has(bob.sessionId)).toBe(true);

    const received = alice.waitForMessage(MSG.chatMsg);
    sendChat(bob, "still here");
    const message = (await received) as { text: string };
    expect(message.text).toBe("still here");
  });
});

describe("MapRoom interest management", () => {
  it("keeps the own player and nearby players visible, hides far ones", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const near = await colyseus.connectTo(room, { name: "Near" });
    const farToken = issueWarpToken(ROOM_NAME_VILLAGE, VILLAGE_SPAWN.x + 1000, VILLAGE_SPAWN.y);
    const far = await colyseus.connectTo(room, { name: "Far", warpToken: farToken });
    await room.waitForNextPatch();

    const aliceServer = room.clients.find((c) => c.sessionId === alice.sessionId)!;
    const aliceState = room.state.players.get(alice.sessionId)!;
    const nearState = room.state.players.get(near.sessionId)!;
    const farState = room.state.players.get(far.sessionId)!;

    expect(aliceServer.view?.has(aliceState)).toBe(true);
    expect(aliceServer.view?.has(nearState)).toBe(true);
    expect(aliceServer.view?.has(farState)).toBe(false);
    expect(clientPlayers(alice)?.has(alice.sessionId)).toBe(true);
    expect(clientPlayers(alice)?.has(near.sessionId)).toBe(true);
    expect(clientPlayers(alice)?.has(far.sessionId)).toBe(false);
  });

  it("uses 850/900 px hysteresis for add and remove", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const alice = await colyseus.connectTo(room, { name: "Alice" });
    const farToken = issueWarpToken(ROOM_NAME_VILLAGE, VILLAGE_SPAWN.x + 1000, VILLAGE_SPAWN.y);
    const far = await colyseus.connectTo(room, { name: "Far", warpToken: farToken });
    await room.waitForNextPatch();

    const aliceServer = room.clients.find((c) => c.sessionId === alice.sessionId)!;
    const aliceState = room.state.players.get(alice.sessionId)!;
    const farState = room.state.players.get(far.sessionId)!;
    expect(aliceServer.view?.has(farState)).toBe(false);

    // 800 px: inside the add radius -> becomes visible.
    farState.x = aliceState.x + 800;
    await waitUntil(() => aliceServer.view?.has(farState) === true, 3000);
    await waitUntil(() => clientPlayers(alice)?.has(far.sessionId) === true, 3000);

    // 950 px: beyond the remove radius -> hidden again.
    farState.x = aliceState.x + 950;
    await waitUntil(() => aliceServer.view?.has(farState) === false, 3000);
    await waitUntil(() => clientPlayers(alice)?.has(far.sessionId) === false, 3000);
  });
});

describe("MapRoom warp", () => {
  it("reserves a seat in the target map and removes the player here", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, {
      name: "Traveller",
      map: ROOM_NAME_FIELDS,
    });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;

    const warpMessage = client.waitForMessage(MSG.warp, 5000);
    // Walk west from the fields spawn into the return warp.
    for (let seq = 1; seq <= 20; seq++) {
      sendInput(client, { seq, kind: "dir", dir: 4 });
    }

    const payload = (await warpMessage) as WarpPayload;
    expect(payload.map).toBe(ROOM_NAME_VILLAGE);
    expect(payload.x).toBe(VILLAGE_SPAWN.x);
    expect(payload.y).toBe(VILLAGE_SPAWN.y);
    expect(payload.reservation.roomId.length).toBeGreaterThan(0);
    expect(payload.reservation.sessionId.length).toBeGreaterThan(0);

    await waitUntil(() => !room.state.players.has(sessionId));
  });

  it("does not bounce back immediately after arriving (warp token)", async () => {
    const fieldsWarp = loadMapAssets(ROOM_NAME_FIELDS).warps[0]!;
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const token = issueWarpToken(
      ROOM_NAME_FIELDS,
      fieldsWarp.x + fieldsWarp.w / 2,
      fieldsWarp.y + fieldsWarp.h / 2,
    );
    const client = await colyseus.connectTo(room, {
      name: "Arrival",
      map: ROOM_NAME_FIELDS,
      warpToken: token,
    });
    await room.waitForNextPatch();

    await sleep(300);
    expect(room.state.players.has(client.sessionId)).toBe(true);
  });

  it("cools down after a failed reservation instead of retrying every tick", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, { name: "Unlucky", map: ROOM_NAME_FIELDS });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;

    let attempts = 0;
    (room as unknown as { reserveSeat: () => Promise<never> }).reserveSeat = () => {
      attempts++;
      return Promise.reject(new Error("matchmaker unavailable"));
    };

    for (let seq = 1; seq <= 20; seq++) {
      sendInput(client, { seq, kind: "dir", dir: 4 });
    }
    await waitUntil(() => attempts > 0, 5000);
    // The player is restored at the warp zone with a cooldown; no immediate
    // second attempt (and no leaked token every 50 ms).
    await sleep(500);
    expect(attempts).toBe(1);
    expect(room.state.players.has(sessionId)).toBe(true);
  });

  it("disconnects a client that ignores the warp message", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, { name: "Ghost", map: ROOM_NAME_FIELDS });
    await room.waitForNextPatch();

    const leavePromise = new Promise<number>((resolve) => {
      client.onLeave((code) => resolve(code));
    });
    const warpMessage = client.waitForMessage(MSG.warp, 5000);
    for (let seq = 1; seq <= 20; seq++) {
      sendInput(client, { seq, kind: "dir", dir: 4 });
    }
    await warpMessage;

    const code = await Promise.race([leavePromise, sleep(4000).then(() => -1)]);
    expect(code).toBe(4000);
  });
});

const WOLF_ZONE_CENTRE = { x: 1376, y: 1312 };

describe("monster spawning", () => {
  it("spawns the four field groups but nothing in the village", async () => {
    const fields = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    expect(fields.state.monsters.size).toBe(21);

    const village = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    expect(village.state.monsters.size).toBe(0);
  });

  it("spawns monsters with client-safe state fields", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const monsters = [...room.state.monsters.values()];
    const boss = monsters.filter((monster) => monster.isBoss);
    expect(boss).toHaveLength(1);
    expect(boss[0]?.typeId).toBe("wolf_king");
    expect(boss[0]?.hp).toBe(boss[0]?.maxHp);

    for (const monster of monsters) {
      expect(monster.name.length).toBeGreaterThan(0);
      expect(monster.level).toBeGreaterThan(0);
      expect(monster.hp).toBeGreaterThan(0);
      expect(monster.maxHp).toBeGreaterThanOrEqual(monster.hp);
    }
  });
});

describe("monster interest management", () => {
  it("delivers nearby monsters and hides the far groups", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, {
      name: "Scout",
      map: ROOM_NAME_FIELDS,
      spawnX: WOLF_ZONE_CENTRE.x,
      spawnY: WOLF_ZONE_CENTRE.y,
    });
    await room.waitForNextPatch();

    const monsters = clientMonsters(client);
    expect(monsters).toBeDefined();
    expect(monsters!.size).toBe(6); // the wolf pack only
    for (const monster of monsters!.values()) {
      expect(monster.isBoss).toBe(false);
      expect(monster.hp).toBeGreaterThan(0);
    }
  });

  it("sends no monsters in the village", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Townie" });
    await room.waitForNextPatch();
    expect(clientMonsters(client)?.size ?? 0).toBe(0);
  });
});

describe("monster AI in the room tick", () => {
  it("chases a player standing in the wolf camp", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, {
      name: "Bait",
      map: ROOM_NAME_FIELDS,
      spawnX: WOLF_ZONE_CENTRE.x,
      spawnY: WOLF_ZONE_CENTRE.y,
    });
    await room.waitForNextPatch();

    const before = new Map(
      [...room.state.monsters].map(([id, monster]) => [id, { x: monster.x, y: monster.y }]),
    );
    const moved = () =>
      [...room.state.monsters].some(([id, monster]) => {
        const start = before.get(id)!;
        return Math.abs(monster.x - start.x) + Math.abs(monster.y - start.y) > 1;
      });

    await waitUntil(moved, 2000);
    expect(moved()).toBe(true);

    const monsterRuntimes = (
      room as unknown as { monsterRuntimes: Map<string, { targetSessionId: string | null }> }
    ).monsterRuntimes;
    expect(
      [...monsterRuntimes.values()].some((monster) => monster.targetSessionId === client.sessionId),
    ).toBe(true);
  });

  it("keeps far monsters asleep", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    await colyseus.connectTo(room, { name: "Far", map: ROOM_NAME_FIELDS });
    await room.waitForNextPatch();

    const before = new Map(
      [...room.state.monsters].map(([id, monster]) => [id, { x: monster.x, y: monster.y }]),
    );
    await sleep(500);

    for (const [id, monster] of room.state.monsters) {
      const start = before.get(id)!;
      expect(monster.x).toBeCloseTo(start.x, 4);
      expect(monster.y).toBeCloseTo(start.y, 4);
    }
    expect(FIELDS_SPAWN.x).toBeLessThan(1000); // the player really is far west
  });
});

describe("player attack", () => {
  async function joinAtWolfCamp(room: MapRoom, name: string) {
    const client = await colyseus.connectTo(room, {
      name,
      map: ROOM_NAME_FIELDS,
      spawnX: WOLF_ZONE_CENTRE.x,
      spawnY: WOLF_ZONE_CENTRE.y,
    });
    await room.waitForNextPatch();
    return { client, events: captureMessages(client, MSG.combat) };
  }

  it("damages an arc target and emits one combat event", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const { client, events } = await joinAtWolfCamp(room, "Fighter");

    const targetId = nearestMonsterId(room, client.sessionId);
    const runtime = monsterRuntimes(room).get(targetId)!;
    runtime.hp = 20;
    room.state.monsters.get(targetId)!.hp = 20;

    const player = room.state.players.get(client.sessionId)!;
    const monster = room.state.monsters.get(targetId)!;
    const dir = dir8Towards({ x: player.x, y: player.y }, { x: monster.x, y: monster.y }) ?? 0;
    sendAttack(client, dir);
    await waitUntil(() => events.length > 0);

    const event = events.find(
      (candidate) => (candidate as CombatEventPayload).attacker.kind === "player",
    ) as CombatEventPayload;
    expect(event).toBeDefined();
    expect(event.attacker).toEqual({ kind: "player", sessionId: client.sessionId });
    expect(event.eventSeq).toBeGreaterThanOrEqual(1);
    const hit = event.hits.find(
      (candidate) => candidate.target.kind === "monster" && candidate.target.monsterId === targetId,
    );
    expect(hit).toBeDefined();
    expect(hit!.miss).toBe(false);
    expect(hit!.damage).toBeGreaterThan(0);

    await room.waitForNextPatch();
    expect(room.state.monsters.get(targetId)!.hp).toBeLessThan(20);
  });

  it("enforces the attack cooldown", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const { client, events } = await joinAtWolfCamp(room, "Spammer");

    const playerEvents = () =>
      events.filter((event) => (event as CombatEventPayload).attacker.kind === "player");

    sendAttack(client, 0);
    await waitUntil(() => playerEvents().length === 1, 2000);

    sendAttack(client, 0);
    sendAttack(client, 0);
    await sleep(200);
    expect(playerEvents().length).toBe(1);

    await sleep(800);
    sendAttack(client, 0);
    await waitUntil(() => playerEvents().length === 2, 2000);
    expect(playerEvents().length).toBe(2);
  });

  it("removes a killed monster and broadcasts monsterDied", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const { client } = await joinAtWolfCamp(room, "Killer");
    const deaths = captureMessages(client, MSG.monsterDied);

    const targetId = nearestMonsterId(room, client.sessionId);
    const runtime = monsterRuntimes(room).get(targetId)!;
    runtime.hp = 1;
    const monster = room.state.monsters.get(targetId)!;
    monster.hp = 1;
    const player = room.state.players.get(client.sessionId)!;
    const dir = dir8Towards({ x: player.x, y: player.y }, { x: monster.x, y: monster.y }) ?? 0;

    sendAttack(client, dir);
    await waitUntil(() => deaths.length > 0);

    const death = deaths[0] as MonsterDiedPayload;
    expect(death.monsterId).toBe(targetId);
    expect(death.killerSessionId).toBe(client.sessionId);
    expect(room.state.monsters.has(targetId)).toBe(false);
    expect(monsterRuntimes(room).has(targetId)).toBe(false);
  });

  it("only sends combat events to clients within the event radius", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const { client: near, events: nearEvents } = await joinAtWolfCamp(room, "Near");
    const far = await colyseus.connectTo(room, { name: "Far", map: ROOM_NAME_FIELDS });
    await room.waitForNextPatch();
    const farEvents = captureMessages(far, MSG.combat);

    const targetId = nearestMonsterId(room, near.sessionId);
    const player = room.state.players.get(near.sessionId)!;
    const monster = room.state.monsters.get(targetId)!;
    const dir = dir8Towards({ x: player.x, y: player.y }, { x: monster.x, y: monster.y }) ?? 0;
    sendAttack(near, dir);

    await waitUntil(() => nearEvents.length > 0);
    expect(farEvents.length).toBe(0);
  });

  it("emits an empty-hit event for a whiff in the village", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Swing" });
    await room.waitForNextPatch();
    const events = captureMessages(client, MSG.combat);

    sendAttack(client, 0);
    await waitUntil(() => events.length > 0);

    expect((events[0] as CombatEventPayload).hits).toEqual([]);
  });
});

describe("player damage, death and respawn", () => {
  async function joinAtWolfCamp(room: MapRoom, name: string) {
    const client = await colyseus.connectTo(room, {
      name,
      map: ROOM_NAME_FIELDS,
      spawnX: WOLF_ZONE_CENTRE.x,
      spawnY: WOLF_ZONE_CENTRE.y,
    });
    await room.waitForNextPatch();
    return client;
  }

  it("monsters damage the player", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await joinAtWolfCamp(room, "Victim");
    const player = room.state.players.get(client.sessionId)!;

    await waitUntil(() => player.hp < player.maxHp, 4000);
    expect(player.hp).toBeGreaterThanOrEqual(0);
    expect(player.dead).toBe(false);
  });

  it("kills the player, sends death, and respawns here after the tuned delay", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await joinAtWolfCamp(room, "Doomed");
    const deaths = captureMessages(client, MSG.death);
    const player = room.state.players.get(client.sessionId)!;
    const runtime = playerRuntimeOf(room, client.sessionId);
    runtime.progression.hp = 1;
    player.hp = 1;

    await waitUntil(() => deaths.length > 0, 4000);
    expect(player.dead).toBe(true);
    expect(player.hp).toBe(0);
    expect(deaths[0]).toMatchObject({ respawnHereAtMs: expect.any(Number) });

    sendRespawn(client, "here");
    await sleep(100);
    expect(player.dead).toBe(true);
    expect(deaths.length).toBeGreaterThan(1); // early request is rejected with a fresh timer

    await sleep(250);
    sendRespawn(client, "here");
    await waitUntil(() => !player.dead, 2000);
    expect(player.hp).toBe(Math.round(player.maxHp * 0.3));
    expect(runtime.dead).toBe(false);
  });

  it("respawns in town through a warp reservation", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await joinAtWolfCamp(room, "Townsfolk");
    const player = room.state.players.get(client.sessionId)!;
    const runtime = playerRuntimeOf(room, client.sessionId);
    runtime.dead = true;
    runtime.diedAtMs = Date.now();
    runtime.dirty = true;
    runtime.progression.hp = 0;
    player.dead = true;
    player.hp = 0;

    const warpMessage = client.waitForMessage(MSG.warp, 5000);
    sendRespawn(client, "town");
    const payload = (await warpMessage) as WarpPayload;

    expect(payload.map).toBe(ROOM_NAME_VILLAGE);
    expect(payload.x).toBe(VILLAGE_SPAWN.x);
    expect(payload.y).toBe(VILLAGE_SPAWN.y);
    const lastSave = fake.saved[fake.saved.length - 1]!;
    expect(lastSave.mapId).toBe(ROOM_NAME_VILLAGE);
    expect(lastSave.x).toBe(VILLAGE_SPAWN.x);
    expect(lastSave.y).toBe(VILLAGE_SPAWN.y);
    expect(lastSave.hp).toBe(player.maxHp);
    expect(lastSave.mp).toBe(player.maxMp);
  });

  it("saves the village at full HP when a dead player disconnects", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, { name: "Fallen", map: ROOM_NAME_FIELDS });
    await room.waitForNextPatch();
    const player = room.state.players.get(client.sessionId)!;
    const runtime = playerRuntimeOf(room, client.sessionId);
    runtime.dead = true;
    runtime.diedAtMs = Date.now();
    runtime.dirty = true;
    runtime.progression.hp = 0;
    player.dead = true;
    player.hp = 0;

    await client.leave();
    await waitUntil(() => fake.saved.some((save) => save.characterId === player.characterId), 2000);
    const saved = fake.saved[fake.saved.length - 1]!;
    expect(saved.mapId).toBe(ROOM_NAME_VILLAGE);
    expect(saved.hp).toBe(runtime.progression.maxHp);
    expect(saved.mp).toBe(runtime.progression.maxMp);
  });
});

describe("progression and stat allocation", () => {
  it("awards kill XP and levels up with a full heal and stat points", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, {
      name: "Grinder",
      map: ROOM_NAME_FIELDS,
      spawnX: WOLF_ZONE_CENTRE.x,
      spawnY: WOLF_ZONE_CENTRE.y,
    });
    await room.waitForNextPatch();
    const player = room.state.players.get(client.sessionId)!;
    const runtime = playerRuntimeOf(room, client.sessionId);
    runtime.progression.xp = 119; // one XP short of level 2
    const stats = captureMessages(client, MSG.selfStats);

    const targetId = nearestMonsterId(room, client.sessionId);
    const monsterRuntime = monsterRuntimes(room).get(targetId)!;
    monsterRuntime.hp = 1;
    const monster = room.state.monsters.get(targetId)!;
    monster.hp = 1;
    const dir = dir8Towards({ x: player.x, y: player.y }, { x: monster.x, y: monster.y }) ?? 0;
    sendAttack(client, dir);

    await waitUntil(() => stats.some((message) => (message as SelfStatsPayload).level === 2), 2000);
    const snapshot = stats[stats.length - 1] as SelfStatsPayload;
    expect(snapshot.xp).toBeGreaterThanOrEqual(0);
    expect(snapshot.xp).toBeLessThan(570); // level-2 requirement
    expect(snapshot.statPoints).toBe(3);
    expect(player.level).toBe(2);
    expect(player.hp).toBe(player.maxHp);

    await waitUntil(
      () => fake.saved.some((save) => save.characterId === player.characterId && save.level === 2),
      2000,
    );
    const saved = fake.saved[fake.saved.length - 1]!;
    expect(saved.xp).toBe(snapshot.xp);
    expect(saved.hp).toBe(player.maxHp);
    expect(saved.statPoints).toBe(3);
  });

  it("spends a stat point and recomputes max HP", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Builder" });
    await room.waitForNextPatch();
    const player = room.state.players.get(client.sessionId)!;
    const runtime = playerRuntimeOf(room, client.sessionId);
    runtime.progression.statPoints = 1;
    const before = runtime.progression.stats.vit;
    const stats = captureMessages(client, MSG.selfStats);

    sendAllocStat(client, "vit");
    await waitUntil(
      () => stats.some((message) => (message as SelfStatsPayload).statPoints === 0),
      2000,
    );

    const snapshot = stats[stats.length - 1] as SelfStatsPayload;
    expect(snapshot.stats.vit).toBe(before + 1);
    expect(snapshot.maxHp).toBe(356); // warrior base 120 + (vit 5)*40 + level*36
    expect(player.maxHp).toBe(356);
  });
});

describe("click-to-attack", () => {
  it("walks to and attacks the selected monster, then cancels on movement input", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, {
      name: "Clicker",
      map: ROOM_NAME_FIELDS,
      spawnX: WOLF_ZONE_CENTRE.x - 220,
      spawnY: WOLF_ZONE_CENTRE.y,
    });
    await room.waitForNextPatch();
    const autoWalks = captureMessages(client, MSG.autoWalk);
    const cleared = captureMessages(client, MSG.targetCleared);
    const combat = captureMessages(client, MSG.combat);

    const targetId = nearestMonsterId(room, client.sessionId);
    const runtime = monsterRuntimes(room).get(targetId)!;
    runtime.hp = 500;
    room.state.monsters.get(targetId)!.hp = 500;

    sendSetTarget(client, targetId);
    await waitUntil(
      () => autoWalks.some((message) => (message as { active: boolean }).active === true),
      2000,
    );

    await waitUntil(
      () =>
        combat.some(
          (message) =>
            (message as CombatEventPayload).attacker.kind === "player" &&
            (message as CombatEventPayload).hits.some(
              (hit) => hit.target.kind === "monster" && hit.target.monsterId === targetId,
            ),
        ),
      4000,
    );
    expect(room.state.monsters.get(targetId)!.hp).toBeLessThan(500);

    sendInput(client, { seq: 1, kind: "none" });
    await waitUntil(
      () => cleared.some((message) => (message as TargetClearedPayload).reason === "cancelled"),
      2000,
    );
    expect(
      cleared.some((message) => (message as TargetClearedPayload).reason === "cancelled"),
    ).toBe(true);
  });
});
