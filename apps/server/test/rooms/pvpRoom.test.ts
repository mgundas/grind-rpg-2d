import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_FIELDS,
  ROOM_NAME_VILLAGE,
  type CombatEventPayload,
  type PvpMode,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import type { JoinIdentity } from "../../src/auth/joinAuth";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;
const savedModes = new Map<string, PvpMode>();

const PORT = 2604;

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function send(client: unknown, type: string, payload: unknown): void {
  (client as { send: (type: string, payload: unknown) => void }).send(type, payload);
}

async function join(room: MapRoom, identity: JoinIdentity) {
  const client = await colyseus.connectTo(room, {
    name: identity.character.name,
    characterId: identity.character.id,
  });
  await room.waitForNextPatch();
  await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));
  return client;
}

async function setMode(client: unknown, mode: PvpMode, room: MapRoom, sessionId: string) {
  send(client, MSG.setPvpMode, { mode });
  await waitUntil(() => room.state.players.get(sessionId)?.pvpMode === mode);
}

function place(room: MapRoom, sessionId: string, x: number, y = 200): void {
  const internals = room as unknown as {
    runtimes: Map<string, { mover: { pos: { x: number; y: number } }; attackReadyAtMs: number }>;
  };
  const runtime = internals.runtimes.get(sessionId)!;
  runtime.mover.pos.x = x;
  runtime.mover.pos.y = y;
  runtime.attackReadyAtMs = 0;
  const player = room.state.players.get(sessionId)!;
  player.x = x;
  player.y = y;
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
    setPvpMode: async (characterId, mode) => {
      savedModes.set(characterId, mode);
      return true;
    },
  });
  await gameServer.listen(PORT);
  colyseus = new ColyseusTestServer(gameServer);
}, 30_000);

afterEach(async () => {
  await colyseus.cleanup();
  fake.reset();
  savedModes.clear();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("room pvp combat", () => {
  it("damages a hostile player in a PvP-allowed map", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const firstIdentity = fake.prepare({ name: "PvpOne", map: ROOM_NAME_FIELDS, kingdom: "ember" });
    const secondIdentity = fake.prepare({ name: "PvpTwo", map: ROOM_NAME_FIELDS, kingdom: "gale" });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    await setMode(first, "free", room, first.sessionId);
    await setMode(second, "free", room, second.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    const before = room.state.players.get(second.sessionId)?.hp ?? 0;

    const combat = new Promise<CombatEventPayload>((resolve) => {
      first.onMessage(MSG.combat, (payload: CombatEventPayload) => {
        if (payload.hits.some((hit) => hit.target.kind === "player")) {
          resolve(payload);
        }
      });
    });
    send(first, MSG.attack, { dir: 0 });
    const event = await combat;
    const hit = event.hits.find((entry) => entry.target.kind === "player");
    expect(hit && !hit.miss).toBe(true);
    await waitUntil(
      () => (room.state.players.get(second.sessionId)?.hp ?? before) < before,
    );
  });

  it("does not damage players in the village safe zone", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const firstIdentity = fake.prepare({ name: "SafeOne", kingdom: "ember" });
    const secondIdentity = fake.prepare({ name: "SafeTwo", kingdom: "gale" });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    await setMode(first, "free", room, first.sessionId);
    await setMode(second, "free", room, second.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    const before = room.state.players.get(second.sessionId)?.hp;

    let playerHit = false;
    first.onMessage(MSG.combat, (payload: CombatEventPayload) => {
      if (payload.hits.some((hit) => hit.target.kind === "player" && !hit.miss)) {
        playerHit = true;
      }
    });
    send(first, MSG.attack, { dir: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(playerHit).toBe(false);
    expect(room.state.players.get(second.sessionId)?.hp).toBe(before);
  });

  it("rejects a peaceful target in a PvP map", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_FIELDS, {});
    const firstIdentity = fake.prepare({ name: "Aggressor", map: ROOM_NAME_FIELDS, kingdom: "ember" });
    const secondIdentity = fake.prepare({ name: "Pacifist", map: ROOM_NAME_FIELDS, kingdom: "gale" });
    const first = await join(room, firstIdentity);
    const second = await join(room, secondIdentity);
    await setMode(first, "free", room, first.sessionId);
    place(room, first.sessionId, 200);
    place(room, second.sessionId, 230);
    const before = room.state.players.get(second.sessionId)?.hp;

    send(first, MSG.attack, { dir: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(room.state.players.get(second.sessionId)?.hp).toBe(before);
  });
});
