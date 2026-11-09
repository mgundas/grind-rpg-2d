import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { ROOM_NAME_SPIDER_CAVE } from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import { DungeonRoom } from "../../src/rooms/DungeonRoom";
import { getServerServices } from "../../src/services";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2605;

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
  getServerServices().parties.clear();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function makeParty(leaders: Array<{ characterId: string; sessionId: string; name: string }>) {
  const registry = getServerServices().parties;
  const [first, ...rest] = leaders;
  let party = registry.create({
    characterId: first!.characterId,
    sessionId: first!.sessionId,
    name: first!.name,
    level: 40,
    classId: "warrior",
    hp: 5000,
    maxHp: 5000,
    mp: 200,
    maxMp: 200,
  });
  for (const member of rest) {
    const invite = registry.invite(first!.characterId, member.characterId, member.name);
    party = registry.accept(invite.inviteId, {
      characterId: member.characterId,
      sessionId: member.sessionId,
      name: member.name,
      level: 40,
      classId: "assassin",
      hp: 3000,
      maxHp: 3000,
      mp: 300,
      maxMp: 300,
    });
  }
  return party;
}

describe("Spider Cave instancing", () => {
  it("rejects a solo player and admits a whole party into one instance", async () => {
    const solo = fake.prepare({ name: "Solo", map: ROOM_NAME_SPIDER_CAVE });
    const soloRoom = await colyseus.createRoom<DungeonRoom>(ROOM_NAME_SPIDER_CAVE, {});
    await expect(
      colyseus.connectTo(soloRoom, { characterId: solo.character.id, name: solo.character.name }),
    ).rejects.toBeTruthy();
    await soloRoom.disconnect();

    const leader = fake.prepare({ name: "Leader", map: ROOM_NAME_SPIDER_CAVE });
    const member = fake.prepare({ name: "Wing", map: ROOM_NAME_SPIDER_CAVE });
    const party = makeParty([
      { characterId: leader.character.id, sessionId: "pending-a", name: leader.character.name },
      { characterId: member.character.id, sessionId: "pending-b", name: member.character.name },
    ]);
    const room = await colyseus.createRoom<DungeonRoom>(ROOM_NAME_SPIDER_CAVE, {
      partyId: party.id,
      channel: 1,
    });
    expect(room.metadata.partyId).toBe(party.id);

    const first = await colyseus.connectTo(room, {
      characterId: leader.character.id,
      name: leader.character.name,
      partyId: party.id,
    });
    const second = await colyseus.connectTo(room, {
      characterId: member.character.id,
      name: member.character.name,
      partyId: party.id,
    });
    await room.waitForNextPatch();
    expect(room.state.players.size).toBe(2);
    // The party survives entry and both sessions are rebound.
    const rebound = getServerServices().parties.getByCharacter(member.character.id);
    expect(rebound?.id).toBe(party.id);
    expect(rebound?.members.get(member.character.id)?.sessionId).toBe(second.sessionId);
    expect(first.sessionId).not.toBe(second.sessionId);
  });

  it("refuses a character from another party", async () => {
    const leader = fake.prepare({ name: "Owner", map: ROOM_NAME_SPIDER_CAVE });
    const outsider = fake.prepare({ name: "Outsider", map: ROOM_NAME_SPIDER_CAVE });
    const party = makeParty([
      { characterId: leader.character.id, sessionId: "p1", name: leader.character.name },
    ]);
    makeParty([
      { characterId: outsider.character.id, sessionId: "p2", name: outsider.character.name },
    ]);
    const room = await colyseus.createRoom<DungeonRoom>(ROOM_NAME_SPIDER_CAVE, {
      partyId: party.id,
      channel: 1,
    });
    await expect(
      colyseus.connectTo(room, {
        characterId: outsider.character.id,
        name: outsider.character.name,
        partyId: party.id,
      }),
    ).rejects.toBeTruthy();
    await room.disconnect();
  });
});
