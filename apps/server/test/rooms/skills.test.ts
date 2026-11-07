import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type SkillErrorPayload,
  type SkillStatePayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2574;

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

async function join(level: number) {
  const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
  const identity = fake.prepare({ name: `Skill${level}${Math.random().toString(36).slice(2, 6)}`, level });
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

describe("doctrine and skill upgrades", () => {
  it("chooses a doctrine and learns a skill", async () => {
    const { room, client, identity } = await join(10);
    const chosenPromise = client.waitForMessage(MSG.skillState, 2000);
    send(client, MSG.chooseDoctrine, { doctrineId: "blade" });
    const chosen = (await chosenPromise) as SkillStatePayload;
    expect(chosen.doctrine).toBe("blade");
    expect(chosen.skills).toHaveLength(6);
    expect(chosen.skillPoints).toBe(6);

    const upgradedPromise = client.waitForMessage(MSG.skillState, 2000);
    send(client, MSG.upgradeSkill, { skillId: "warrior_blade_whirlwind" });
    const upgraded = (await upgradedPromise) as SkillStatePayload;
    const learned = upgraded.skills.find(
      (skill) => skill.skillId === "warrior_blade_whirlwind",
    );
    expect(learned?.rank).toBe(1);
    expect(upgraded.skillPoints).toBe(5);
    expect(fake.saveSkillState).toHaveBeenCalled();
    expect(fake.identities.get(identity.character.id)?.character.doctrine).toBe("blade");
    expect(fake.identities.get(identity.character.id)?.character.skills.warrior_blade_whirlwind).toBe(
      1,
    );

    // The next tick keeps the room alive and flushes the pending save chain.
    await room.waitForNextPatch();
  });

  it("rejects a second doctrine choice", async () => {
    const { client, identity } = await join(10);
    const chosen = client.waitForMessage(MSG.skillState, 2000);
    send(client, MSG.chooseDoctrine, { doctrineId: "blade" });
    await chosen;

    const errorPromise = client.waitForMessage(MSG.skillError, 2000);
    send(client, MSG.chooseDoctrine, { doctrineId: "iron_body" });
    const error = (await errorPromise) as SkillErrorPayload;
    expect(error.code).toBe("doctrine_locked");
    expect(fake.identities.get(identity.character.id)?.character.doctrine).toBe("blade");
  });

  it("enforces the level gate and the doctrine skill pool", async () => {
    const low = await join(4);
    const lowErrorPromise = low.client.waitForMessage(MSG.skillError, 2000);
    send(low.client, MSG.chooseDoctrine, { doctrineId: "blade" });
    expect(((await lowErrorPromise) as SkillErrorPayload).code).toBe("level_too_low");

    const { client } = await join(10);
    const chosen = client.waitForMessage(MSG.skillState, 2000);
    send(client, MSG.chooseDoctrine, { doctrineId: "blade" });
    await chosen;

    const foreignPromise = client.waitForMessage(MSG.skillError, 2000);
    send(client, MSG.upgradeSkill, { skillId: "warrior_iron_body_shield_bash" });
    expect(((await foreignPromise) as SkillErrorPayload).code).toBe("not_in_doctrine");
  });
});
