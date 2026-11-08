#!/usr/bin/env node
/**
 * Phase-6 live acceptance helper. Requires `pnpm dev` (Postgres + server) and
 * a seeded admin account (`pnpm seed`).
 *
 * Covers: two players form a party, choose doctrines, learn/cast skills, break
 * a spirit stone together, both gain XP, and the field-boss timer is delivered.
 *
 * Usage:
 *   pnpm seed
 *   pnpm verify:phase6-e2e
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("../apps/client/node_modules/@colyseus/sdk");
const { Client: PgClient } = require("../apps/server/node_modules/pg");

const WS_URL = process.env.E2E_SERVER_URL ?? "ws://localhost:2567";
const HTTP_URL = WS_URL.replace(/^ws/, "http").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "change-me-please-8-chars";
const PASSWORD = "correct-horse-battery";
const MAP = "map_ember_fields";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = () => Math.random().toString(36).slice(2, 8);

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures += 1;
}

async function waitUntil(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
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

async function relocateToFields(characterId) {
  const client = new PgClient({
    host: process.env.POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "jade",
    password: process.env.POSTGRES_PASSWORD ?? "",
    database: process.env.POSTGRES_DB ?? "jade_throne",
  });
  await client.connect();
  try {
    await client.query(
      "UPDATE characters SET map_id = $1, x = $2, y = $3 WHERE id = $4",
      [MAP, 2944, 3712, characterId],
    );
  } finally {
    await client.end();
  }
}

async function createPlayer(classId, prefix) {
  const id = suffix();
  const creds = {
    email: `${prefix}${id}@example.com`,
    username: `${prefix}${id}`,
    password: PASSWORD,
    kingdom: "ember",
  };
  const registered = await api("/api/auth/register", { method: "POST", body: creds });
  if (registered.status !== 201) throw new Error(`register failed: ${registered.status}`);
  const auth = registered.data;
  const created = await api("/api/characters", {
    method: "POST",
    token: auth.tokens.accessToken,
    body: { name: `${prefix}${suffix()}`, classId, gender: "male", hairStyle: 0, hairColor: 0 },
  });
  if (created.status !== 201) throw new Error(`create character failed: ${created.status}`);
  return { auth, creds, character: created.data.character };
}

const send = (client, type, payload) => client.send(type, payload);
const self = (room) => room.state?.players?.get(room.sessionId);

function nextMessage(client, type, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const off = client.onMessage(type, (payload) => {
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dirTo(from, to) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  let index = Math.round(angle / (Math.PI / 4));
  if (index < 0) index += 8;
  return index % 8;
}

function nextMessageWhere(client, type, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const off = client.onMessage(type, (payload) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        off();
        resolve(payload);
      }
    });
  });
}

async function joinPlayer(player, token) {
  const client = new Client(WS_URL);
  client.auth.token = token;
  const room = await client.joinOrCreate(MAP, {
    characterId: player.id,
    map: MAP,
  });
  await waitUntil(() => Boolean(self(room)));
  let stats = null;
  room.onMessage("selfStats", (payload) => {
    stats = payload;
  });
  room.send("requestStats", {});
  await waitUntil(() => Boolean(stats));
  return { client: room, room, getStats: () => stats };
}

async function chooseAndLearn(client, doctrineId, skillIds) {
  const chosen = nextMessage(client, "skillState", 3000);
  send(client, "chooseDoctrine", { doctrineId });
  await chosen;
  for (const skillId of skillIds) {
    const learned = nextMessage(client, "skillState", 3000);
    send(client, "upgradeSkill", { skillId });
    await learned;
  }
}

async function walkNear(client, room, target, radius = 50) {
  let seq = 1;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const me = self(room);
    if (me && distance(me, target) <= radius) {
      return;
    }
    send(client, "input", { seq: seq++, kind: "path", x: target.x, y: target.y });
    await wait(900);
  }
  const me = self(room);
  throw new Error(
    `walk timed out at ${me ? distance(me, target).toFixed(1) : "no player"} px`,
  );
}

async function main() {
  const adminLogin = await api("/api/auth/login", {
    method: "POST",
    body: { login: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (adminLogin.status !== 200) {
    throw new Error(`admin login failed (${adminLogin.status}); run "pnpm seed"`);
  }
  const adminToken = adminLogin.data.tokens.accessToken;

  const warrior = await createPlayer("warrior", "P6W");
  const mystic = await createPlayer("mystic", "P6M");
  for (const player of [warrior, mystic]) {
    const boosted = await api(`/api/admin/players/${player.character.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { level: 30, statVit: 90, statInt: 90, statStr: 90, statDex: 90 },
    });
    check("admin prepares a test character", boosted.status === 200, String(boosted.status));
    await relocateToFields(player.character.id);
  }

  const first = await joinPlayer(warrior.character, warrior.auth.tokens.accessToken);
  const second = await joinPlayer(mystic.character, mystic.auth.tokens.accessToken);
  check("both players join Ember Fields", Boolean(self(first.room)) && Boolean(self(second.room)));

  await chooseAndLearn(first.client, "blade", [
    "warrior_blade_whirlwind",
    "warrior_blade_berserk",
  ]);
  await chooseAndLearn(second.client, "grace", ["mystic_grace_healing_light"]);

  const buffState = nextMessage(first.client, "buffState", 3000);
  const skillFx = nextMessage(first.client, "skillCast", 3000);
  send(first.client, "castSkill", { skillId: "warrior_blade_berserk" });
  check("skill cast produces a buff", Boolean(await buffState));
  check("skill cast produces an FX event", Boolean(await skillFx));

  const partyJoinedFirst = nextMessageWhere(first.client, "partyState", (payload) => payload.members.length === 2);
  const partyJoinedSecond = nextMessageWhere(second.client, "partyState", (payload) => payload.members.length === 2);
  const invitePromise = nextMessage(second.client, "partyInvite", 3000);
  send(first.client, "partyInvite", { characterId: mystic.character.id });
  const invite = await invitePromise;
  send(second.client, "partyRespond", { inviteId: invite.inviteId, accept: true });
  const [partyA, partyB] = await Promise.all([partyJoinedFirst, partyJoinedSecond]);
  check(
    "two players form a party",
    partyA.members.length === 2 && partyB.members.length === 2,
  );

  const timerPromise = nextMessage(first.client, "bossTimer", 3000);
  send(first.client, "requestBossTimer", {});
  const timer = await timerPromise;
  check("field boss timer is delivered", timer.bossTypeId === "wolf_king", timer.name);

  let stone = null;
  first.room.state.stones?.forEach((candidate) => {
    if (!stone) stone = { ...candidate };
  });
  check("spirit stone is visible", Boolean(stone));
  if (!stone) throw new Error("no spirit stone spawned");

  await walkNear(first.client, first.room, stone);
  await walkNear(second.client, second.room, stone);
  await waitUntil(
    () => self(first.room) && self(second.room),
    3000,
  );

  const initialHp = stone.hp;
  const beforeFirst = first.getStats();
  const beforeSecond = second.getStats();
  const deadline = Date.now() + 60_000;
  let damagedHp = initialHp;
  while (Date.now() < deadline) {
    const meA = self(first.room);
    const meB = self(second.room);
    if (!meA || !meB) break;
    send(first.client, "attack", { dir: dirTo(meA, stone) });
    send(second.client, "attack", { dir: dirTo(meB, stone) });
    await wait(350);
    const current = first.room.state.stones?.get?.(stone.stoneId);
    if (!current) {
      damagedHp = 0;
      break;
    }
    damagedHp = current.hp;
  }
  check(
    "the party breaks the spirit stone together",
    damagedHp === 0 || !first.room.state.stones?.get?.(stone.stoneId),
  );
  await wait(1200);
  const afterFirst = first.getStats();
  const afterSecond = second.getStats();
  const gained = (before, after) =>
    after && before && (after.level > before.level || after.xp > before.xp);
  check("first member gains party XP", gained(beforeFirst, afterFirst));
  check("second member gains party XP", gained(beforeSecond, afterSecond));
  await wait(1200);

  await first.room.leave().catch(() => {});
  await second.room.leave().catch(() => {});
}

try {
  await main();
} catch (error) {
  console.error(error);
  failures += 1;
}

if (failures > 0) {
  console.error(`\n${failures} Phase-6 live check(s) failed.`);
  process.exit(1);
}
console.log("\nAll Phase-6 live checks passed.");
