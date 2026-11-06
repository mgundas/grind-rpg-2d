import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { ROOM_NAME_FIELDS, ROOM_NAME_VILLAGE, isWalkableAt } from "@jadethrone/shared";
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
