import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  isWalkableAt,
  type InputMessage,
} from "@jadethrone/shared";
import { FIELDS_SPAWN, VILLAGE_SPAWN } from "@jadethrone/data";
import { createGameServer } from "../../src/server";
import { MapRoom } from "../../src/rooms/MapRoom";

let colyseus: ColyseusTestServer;

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

beforeAll(async () => {
  colyseus = await boot(createGameServer());
}, 30_000);

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("MapRoom join", () => {
  it("spawns a guest at the village spawn with synced state", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Alice" });
    await room.waitForNextPatch();

    const player = room.state.players.get(client.sessionId);
    expect(player).toBeDefined();
    expect(player!.name).toBe("Alice");
    expect(player!.kingdom).toBe("ember");
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
  });

  it("spawns on the fields at their own spawn point", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const client = await colyseus.connectTo(room, { name: "Scout" });
    await room.waitForNextPatch();

    const player = room.state.players.get(client.sessionId)!;
    expect(player.x).toBeCloseTo(FIELDS_SPAWN.x, 5);
    expect(player.y).toBeCloseTo(FIELDS_SPAWN.y, 5);
  });

  it("honors a walkable reservation position (warp arrivals)", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const target = { x: VILLAGE_SPAWN.x + 64, y: VILLAGE_SPAWN.y };
    const client = await colyseus.connectTo(room, { name: "Warped", ...target });
    await room.waitForNextPatch();

    const player = room.state.players.get(client.sessionId)!;
    expect(player.x).toBeCloseTo(target.x, 5);
    expect(player.y).toBeCloseTo(target.y, 5);
  });

  it("snaps a blocked reservation position to walkable ground", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Stuck", x: 16, y: 16 });
    await room.waitForNextPatch();

    const player = room.state.players.get(client.sessionId)!;
    const roomAny = room as unknown as { assets: { grid: Parameters<typeof isWalkableAt>[0] } };
    expect(isWalkableAt(roomAny.assets.grid, player.x, player.y)).toBe(true);
    expect(player.x).not.toBe(16);
    expect(player.y).not.toBe(16);
  });

  it("sanitizes display names", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "  Bad\nName!!  " });
    await room.waitForNextPatch();
    expect(room.state.players.get(client.sessionId)!.name).toBe("BadName");

    const second = await colyseus.connectTo(room, { name: "a" });
    await room.waitForNextPatch();
    expect(room.state.players.get(second.sessionId)!.name).toBe("Guest");
  });

  it("falls back on invalid option types without discarding the whole message", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, {
      name: "KeptName",
      kingdom: "not-a-kingdom",
    });
    await room.waitForNextPatch();

    const player = room.state.players.get(client.sessionId)!;
    expect(player.name).toBe("KeptName");
    expect(player.kingdom).toBe("ember");
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
    const client = await colyseus.connectTo(room, {
      name: "Wall",
      x: VILLAGE_SPAWN.x,
      y: 80,
    });
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

  it("stops after the input grace period", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const client = await colyseus.connectTo(room, { name: "Grace" });
    await room.waitForNextPatch();
    const sessionId = client.sessionId;

    sendInput(client, { seq: 1, kind: "dir", dir: 0 });
    await waitUntil(() => room.state.players.get(sessionId)!.lastSeq === 1);
    await sleep(350);
    const settled = room.state.players.get(sessionId)!;
    expect(settled.moving).toBe(false);
    const settledX = settled.x;
    await sleep(150);
    expect(room.state.players.get(sessionId)!.x).toBe(settledX);
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
    const bob = await colyseus.connectTo(room, {
      name: "Bob",
      x: VILLAGE_SPAWN.x + 1000,
      y: VILLAGE_SPAWN.y,
    });
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
