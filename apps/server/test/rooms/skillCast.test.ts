import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type BuffStatePayload,
  type SelfStatsPayload,
  type SkillCastPayload,
  type SkillCastStartPayload,
  type SkillErrorPayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2586;

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

async function join() {
  const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
  const identity = fake.prepare({
    name: `Caster${Math.random().toString(36).slice(2, 7)}`,
    level: 20,
    doctrine: "blade",
    skills: { warrior_blade_whirlwind: 1, warrior_blade_berserk: 1 },
    skillPoints: 4,
  });
  const client = await colyseus.connectTo(room, {
    name: identity.character.name,
    characterId: identity.character.id,
  });
  await room.waitForNextPatch();
  await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));
  return { room, client, identity };
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

describe("room skill casting", () => {
  it("starts a cast, consumes MP, applies a buff and enforces cooldown", async () => {
    const { room, client } = await join();
    const startPromise = client.waitForMessage(MSG.skillCastStart, 2000);
    const castPromise = client.waitForMessage(MSG.skillCast, 2000);
    const buffPromise = client.waitForMessage(MSG.buffState, 2000);
    const startErrorPromise = client.waitForMessage(MSG.skillError, 2000);

    send(client, MSG.castSkill, { skillId: "warrior_blade_berserk" });
    const start = (await Promise.race([startPromise, startErrorPromise])) as
      | SkillCastStartPayload
      | SkillErrorPayload;
    if ("code" in start) {
      throw new Error(`cast rejected: ${start.code} ${start.message}`);
    }
    expect(start.skillId).toBe("warrior_blade_berserk");
    const cast = (await castPromise) as SkillCastPayload;
    expect(cast.skillId).toBe("warrior_blade_berserk");
    const buffs = (await buffPromise) as BuffStatePayload;
    expect(buffs.buffs.some((buff) => buff.sourceSkillId === "warrior_blade_berserk")).toBe(true);
    const statsPromise = client.waitForMessage(MSG.selfStats, 2000);
    send(client, MSG.requestStats, {});
    const stats = (await statsPromise) as SelfStatsPayload;
    expect(stats.mp).toBe(92 - 20);

    await room.waitForNextPatch();
    const errorPromise = client.waitForMessage(MSG.skillError, 2000);
    send(client, MSG.castSkill, { skillId: "warrior_blade_berserk" });
    expect(((await errorPromise) as SkillErrorPayload).code).toBe("on_cooldown");
  });

  it("rejects a skill from an unchosen doctrine", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const identity = fake.prepare({ name: "NoDoctrine", level: 10 });
    const client = await colyseus.connectTo(room, {
      name: identity.character.name,
      characterId: identity.character.id,
    });
    await room.waitForNextPatch();
    const errorPromise = client.waitForMessage(MSG.skillError, 2000);
    send(client, MSG.castSkill, { skillId: "warrior_blade_whirlwind" });
    expect(((await errorPromise) as SkillErrorPayload).code).toBe("skill_locked");
  });
});
