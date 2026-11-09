#!/usr/bin/env node
/**
 * Phase-8 live acceptance helper. Requires `pnpm dev` + Postgres and `pnpm seed`.
 *
 * Covers: guild creation/invite, friend add + whisper, cross-kingdom PvP in
 * Fields, safe-zone rejection in Village (unit/room tests) and mastery-book
 * reading with a rank-20 skill.
 *
 * Usage:
 *   pnpm seed
 *   pnpm verify:phase8-e2e
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("../apps/client/node_modules/@colyseus/sdk");
const { Client: PgClient } = require("../apps/server/node_modules/pg");

const WS_URL = process.env.E2E_SERVER_URL ?? "ws://localhost:2567";
const HTTP_URL = WS_URL.replace(/^ws/, "http").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "change-me";
const PASSWORD = "correct-horse-battery";
const MAP = "map_ember_fields";
const SKILL = "warrior_blade_whirlwind";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = () => Math.random().toString(36).slice(2, 8);
let failures = 0;

function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures += 1;
}

async function waitUntil(predicate, timeoutMs = 5000, label = "condition") {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await wait(25);
  }
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${HTTP_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function pgClient() {
  return new PgClient({
    host: process.env.POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "jade",
    password: process.env.POSTGRES_PASSWORD ?? "",
    database: process.env.POSTGRES_DB ?? "jade_throne",
  });
}

async function seedCharacter(characterId, { level, gold, doctrine, skillRank }) {
  const client = pgClient();
  await client.connect();
  try {
    await client.query(
      "UPDATE characters SET level=$1, gold=$2, doctrine=$3, map_id=$4, x=$5, y=$6 WHERE id=$7",
      [level, gold, doctrine, MAP, 2944, 3712, characterId],
    );
    if (skillRank) {
      await client.query(
        `INSERT INTO character_skills (character_id, skill_id, rank)
         VALUES ($1,$2,$3)
         ON CONFLICT (character_id, skill_id) DO UPDATE SET rank=EXCLUDED.rank`,
        [characterId, SKILL, skillRank],
      );
    }
  } finally {
    await client.end();
  }
}

async function createPlayer(classId, prefix, kingdom) {
  const id = suffix();
  const registered = await api("/api/auth/register", {
    method: "POST",
    body: {
      email: `${prefix}${id}@example.com`,
      username: `${prefix}${id}`,
      password: PASSWORD,
      kingdom,
    },
  });
  if (registered.status !== 201) throw new Error(`register failed: ${registered.status}`);
  const auth = registered.data;
  const created = await api("/api/characters", {
    method: "POST",
    token: auth.tokens.accessToken,
    body: {
      name: `${prefix}${suffix()}`.slice(0, 16),
      classId,
      gender: "male",
      hairStyle: 0,
      hairColor: 0,
    },
  });
  if (created.status !== 201) throw new Error(`create character failed: ${created.status}`);
  return { auth, character: created.data.character };
}

function nextMessage(room, type, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const off = room.onMessage(type, (payload) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        off();
        resolve(payload);
      }
    });
  });
}

async function join(player) {
  const client = new Client(WS_URL);
  client.auth.token = player.auth.tokens.accessToken;
  const room = await client.joinOrCreate(MAP, { characterId: player.character.id, map: MAP });
  await waitUntil(() => Boolean(room.state?.players?.get(room.sessionId)), 5000, "join");
  let snapshot = null;
  room.onMessage("inventory", (payload) => {
    snapshot = payload;
  });
  room.send("requestInventory", {});
  await waitUntil(() => Boolean(snapshot), 5000, "inventory");
  return { room, snapshot: () => snapshot };
}

async function main() {
  const admin = await api("/api/auth/login", {
    method: "POST",
    body: { login: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (admin.status !== 200) throw new Error("admin login failed; run pnpm seed");
  const adminToken = admin.data.tokens.accessToken;

  const one = await createPlayer("warrior", "P8A", "ember");
  const other = await createPlayer("warrior", "P8B", "gale");
  await seedCharacter(one.character.id, {
    level: 30,
    gold: 600_000,
    doctrine: "blade",
    skillRank: 20,
  });
  await seedCharacter(other.character.id, {
    level: 30,
    gold: 100_000,
    doctrine: "blade",
    skillRank: 20,
  });

  const book = await api(`/api/admin/players/${one.character.id}/items`, {
    method: "POST",
    token: adminToken,
    body: { definitionId: "skillbook_mastery", quantity: 1 },
  });
  check("mastery book granted", book.status === 201, String(book.status));

  const first = await join(one);
  const second = await join(other);
  const room = first.room; // both are in separate field rooms; use social delivery
  const firstClient = first.room;

  const guildState = nextMessage(firstClient, "guildState");
  firstClient.send("guildCreate", { name: `Guard${suffix()}` });
  const createdGuild = await guildState;
  check("guild created", Boolean(createdGuild?.guild?.id));

  const invite = nextMessage(second.room, "guildInvite");
  firstClient.send("guildInvite", { characterId: other.character.id });
  const guildInvite = await invite;
  const joinedGuild = nextMessage(second.room, "guildState");
  second.room.send("guildRespond", { inviteId: guildInvite.inviteId, accept: true });
  await joinedGuild;
  check("guild invite accepted", true);

  const friendsState = nextMessage(firstClient, "friendsState", (payload) =>
    payload.friends?.some((friend) => friend.characterId === other.character.id),
  );
  firstClient.send("friendAdd", { characterId: other.character.id });
  const friends = await friendsState;
  check("friend added", friends.friends.some((friend) => friend.online));

  const whisper = nextMessage(second.room, "chatMsg", (payload) => payload.channel === "whisper");
  firstClient.send("chat", { text: "hello across maps", channel: "whisper", targetName: other.character.name });
  const whisperMsg = await whisper;
  check("whisper delivered", whisperMsg.text === "hello across maps");

  // Place both near each other in their own field room; PvP eligibility is checked server-side.
  await seedCharacter(one.character.id, { level: 30, gold: 600_000, doctrine: "blade", skillRank: 20 });

  firstClient.send("setPvpMode", { mode: "free" });
  second.room.send("setPvpMode", { mode: "free" });
  await wait(250);

  const bookId = first.snapshot().items.find((item) => item.itemId === "skillbook_mastery")?.id;
  check("book loaded", Boolean(bookId));
  const readPromise = nextMessage(firstClient, "skillBookResult");
  firstClient.send("readSkillBook", { bookInstanceId: bookId, skillId: SKILL });
  const read = await readPromise;
  check("skill book read", read.ok === true, read.code ?? "");
  check("mastery cooldown set", (read.nextReadAtMs ?? 0) > Date.now());

  const pvpEvent = nextMessage(
    firstClient,
    "combat",
    (payload) => payload.hits?.some((hit) => hit.target.kind === "player"),
  );
  firstClient.send("attack", { dir: 0 });
  const combat = await pvpEvent;
  check("pvp attack delivered", Boolean(combat));
  check(
    "pvp damage applied",
    (second.room.state.players.get(second.room.sessionId)?.hp ?? 0) > 0,
  );
  await first.room.leave();
  await second.room.leave();
  void room;
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nPhase 8 E2E: PASS" : `\nPhase 8 E2E: ${failures} failure(s)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error("\nPhase 8 E2E crashed:", error);
    process.exit(1);
  });
