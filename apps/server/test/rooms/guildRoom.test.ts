import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  MSG,
  ROOM_NAME_VILLAGE,
  type ChatMsgPayload,
  type GuildInvitePayload,
  type GuildStatePayload,
} from "@jadethrone/shared";
import { createGameServer } from "../../src/server";
import type { GuildRecord, GuildService } from "../../src/guilds/service";
import type { MapRoom } from "../../src/rooms/MapRoom";
import { createFakeServices, type FakeServices } from "./fakes";

let colyseus: ColyseusTestServer;
let fake: FakeServices;

const PORT = 2594;

function createFakeGuildService(services: FakeServices): GuildService {
  const guilds = new Map<string, GuildRecord>();
  let sequence = 0;

  const member = (guild: GuildRecord, characterId: string) =>
    guild.members.find((entry) => entry.characterId === characterId);

  return {
    async loadByCharacter(characterId) {
      for (const guild of guilds.values()) {
        if (member(guild, characterId)) {
          return guild;
        }
      }
      return null;
    },
    async loadById(guildId) {
      return guilds.get(guildId) ?? null;
    },
    async create(characterId, name) {
      const identity = services.identities.get(characterId);
      if (!identity) {
        throw new Error("missing identity");
      }
      const id = `guild-${++sequence}`;
      guilds.set(id, {
        id,
        name,
        leaderCharacterId: characterId,
        members: [
          {
            characterId,
            name: identity.character.name,
            level: identity.character.level,
            mapId: identity.character.map,
            rank: "leader",
          },
        ],
      });
      return id;
    },
    async join(guildId, characterId) {
      const guild = guilds.get(guildId);
      const identity = services.identities.get(characterId);
      if (!guild || !identity || member(guild, characterId)) {
        throw new Error("cannot join");
      }
      guild.members.push({
        characterId,
        name: identity.character.name,
        level: identity.character.level,
        mapId: identity.character.map,
        rank: "member",
      });
    },
    async leave(characterId) {
      for (const guild of guilds.values()) {
        guild.members = guild.members.filter((entry) => entry.characterId !== characterId);
      }
    },
    async kick(_actor, target) {
      for (const guild of guilds.values()) {
        guild.members = guild.members.filter((entry) => entry.characterId !== target);
      }
    },
    async setRank(_actor, target, rank) {
      for (const guild of guilds.values()) {
        const entry = member(guild, target);
        if (entry) {
          entry.rank = rank;
        }
      }
    },
    async disband(characterId) {
      for (const [id, guild] of guilds) {
        if (member(guild, characterId)) {
          guilds.delete(id);
        }
      }
    },
  };
}

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

async function join(room: MapRoom, name: string) {
  const identity = fake.prepare({ name });
  const client = await colyseus.connectTo(room, {
    name: identity.character.name,
    characterId: identity.character.id,
  });
  await room.waitForNextPatch();
  await waitUntil(() => Boolean(fake.adminBus.get(identity.character.id)));
  return { client, identity };
}

beforeAll(async () => {
  fake = createFakeServices();
  const guilds = createFakeGuildService(fake);
  const gameServer = createGameServer({
    joinAuthenticator: fake.joinAuthenticator,
    saveCharacter: fake.saveCharacter,
    saveCharacters: fake.saveCharacters,
    loadCharacter: fake.loadCharacter,
    saveSkillState: fake.saveSkillState,
    items: fake.items,
    guilds,
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

describe("room guild integration", () => {
  it("creates a guild, invites an online player and updates live tags", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await join(room, "GuildFounder");
    const second = await join(room, "GuildRecruit");

    const created = first.client.waitForMessage(MSG.guildState, 2000);
    send(first.client, MSG.guildCreate, { name: "Jade Guard" });
    const founderState = (await created) as GuildStatePayload;
    expect(founderState.guild?.name).toBe("Jade Guard");
    expect(founderState.guild?.members[0]?.rank).toBe("leader");
    expect(room.state.players.get(first.client.sessionId)?.guildName).toBe("Jade Guard");

    const invitePromise = second.client.waitForMessage(MSG.guildInvite, 2000);
    send(first.client, MSG.guildInvite, { name: "GuildRecruit" });
    const invite = (await invitePromise) as GuildInvitePayload;
    expect(invite.guildName).toBe("Jade Guard");

    const founderUpdate = first.client.waitForMessage(MSG.guildState, 2000);
    const recruitState = second.client.waitForMessage(MSG.guildState, 2000);
    send(second.client, MSG.guildRespond, { inviteId: invite.inviteId, accept: true });
    const [, joined] = (await Promise.all([founderUpdate, recruitState])) as [
      GuildStatePayload,
      GuildStatePayload,
    ];
    expect(joined.guild?.name).toBe("Jade Guard");
    expect(joined.guild?.members.map((member) => member.rank).sort()).toEqual([
      "leader",
      "member",
    ]);
    expect(room.state.players.get(second.client.sessionId)?.guildName).toBe(
      "Jade Guard",
    );

    const founderChat = first.client.waitForMessage(MSG.chatMsg, 2000);
    const recruitChat = second.client.waitForMessage(MSG.chatMsg, 2000);
    send(first.client, MSG.chat, { text: "welcome to the guard", channel: "guild" });
    const [chatA, chatB] = (await Promise.all([founderChat, recruitChat])) as [
      ChatMsgPayload,
      ChatMsgPayload,
    ];
    expect(chatA.channel).toBe("guild");
    expect(chatA.text).toBe("welcome to the guard");
    expect(chatB.channel).toBe("guild");
  });

  it("rejects guild invites from someone without a guild", async () => {
    const room = await colyseus.createRoom<MapRoom>(ROOM_NAME_VILLAGE, {});
    const first = await join(room, "NoGuild");
    const second = await join(room, "OtherPlayer");
    const rejected = first.client.waitForMessage(MSG.guildError, 2000);
    send(first.client, MSG.guildInvite, { characterId: second.identity.character.id });
    expect(((await rejected) as { code: string }).code).toBe("not_member");
  });
});
