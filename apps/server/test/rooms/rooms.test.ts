import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  TICK_MS,
  createMover,
  isWalkableAt,
  stepMover,
  type InputMessage,
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
      savePosition: fake.savePosition,
      savePositions: fake.savePositions,
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

    expect(fake.savePositions).toHaveBeenCalledOnce();
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
