#!/usr/bin/env node
/**
 * Phase-7 live acceptance helper. Requires `pnpm dev` (Postgres + server) and a
 * seeded admin account (`pnpm seed`).
 *
 * Covers: admin grants, blacksmith preview/upgrade, enchant/reinforce scroll
 * application, a two-player item+gold trade and an item hot-reload without a
 * server restart. Exact +4 odds are covered by the seeded unit suite.
 *
 * Usage:
 *   pnpm seed
 *   pnpm verify:phase7-e2e
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
const MAP = "map_ember_village";

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

async function createPlayer(classId, prefix) {
  const id = suffix();
  const registered = await api("/api/auth/register", {
    method: "POST",
    body: {
      email: `${prefix}${id}@example.com`,
      username: `${prefix}${id}`,
      password: PASSWORD,
      kingdom: "ember",
    },
  });
  if (registered.status !== 201) throw new Error(`register failed: ${registered.status}`);
  const auth = registered.data;
  const created = await api("/api/characters", {
    method: "POST",
    token: auth.tokens.accessToken,
    body: {
      name: `${prefix}${suffix()}`,
      classId,
      gender: "male",
      hairStyle: 0,
      hairColor: 0,
    },
  });
  if (created.status !== 201) throw new Error(`create character failed: ${created.status}`);
  return { auth, character: created.data.character };
}

async function relocate(characterId, x, y) {
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
      [MAP, x, y, characterId],
    );
  } finally {
    await client.end();
  }
}

const send = (room, type, payload) => room.send(type, payload);
const self = (room) => room.state?.players?.get(room.sessionId);

function nextMessage(room, type, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const off = room.onMessage(type, (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });
}

async function join(player) {
  const client = new Client(WS_URL);
  client.auth.token = player.auth.tokens.accessToken;
  const room = await client.joinOrCreate(MAP, {
    characterId: player.character.id,
    map: MAP,
  });
  await waitUntil(() => Boolean(self(room)), 5000, "join");
  let snapshot = null;
  room.onMessage("inventory", (payload) => {
    snapshot = payload;
  });
  room.send("requestInventory", {});
  await waitUntil(() => Boolean(snapshot), 5000, "inventory");
  return { room, snapshot: () => snapshot };
}

async function adminLogin() {
  const result = await api("/api/auth/login", {
    method: "POST",
    body: { login: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (result.status !== 200) {
    throw new Error("admin login failed; run `pnpm seed` and check ADMIN_EMAIL/PASSWORD");
  }
  return result.data.tokens.accessToken;
}

async function main() {
  const adminToken = await adminLogin();
  const one = await createPlayer("warrior", "P7A");
  const two = await createPlayer("warrior", "P7B");

  for (const player of [one, two]) {
    const patched = await api(`/api/admin/players/${player.character.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { gold: 250_000 },
    });
    check("admin sets gold", patched.status === 200, String(patched.status));
  }

  const sword = await api(`/api/admin/players/${one.character.id}/items`, {
    method: "POST",
    token: adminToken,
    body: { definitionId: "sword_ember_t1", quantity: 1, upgradeLevel: 3 },
  });
  check("admin grants +3 sword", sword.status === 201, String(sword.status));
  const spare = await api(`/api/admin/players/${one.character.id}/items`, {
    method: "POST",
    token: adminToken,
    body: { definitionId: "sword_ember_t1", quantity: 1 },
  });
  const spareSwordId = spare.data?.item?.id;
  check("admin grants spare sword", spare.status === 201, String(spare.status));
  for (const [definitionId, quantity] of [
    ["material_wolf_fang", 5],
    ["scroll_enchant", 2],
    ["scroll_reinforce", 2],
    ["potion_hp_s", 5],
  ]) {
    const granted = await api(`/api/admin/players/${one.character.id}/items`, {
      method: "POST",
      token: adminToken,
      body: { definitionId, quantity },
    });
    check(`admin grants ${definitionId}`, granted.status === 201, String(granted.status));
  }

  await relocate(one.character.id, 36 * 32 + 8, 40 * 32 + 8);
  await relocate(two.character.id, 36 * 32 + 24, 40 * 32 + 24);
  const first = await join(one);
  const second = await join(two);

  const swordId = first.snapshot().items.find((item) => item.itemId === "sword_ember_t1")?.id;
  const fangId = first.snapshot().items.find((item) => item.itemId === "material_wolf_fang")?.id;
  const enchantId = first.snapshot().items.find((item) => item.itemId === "scroll_enchant")?.id;
  const reinforceId = first.snapshot().items.find((item) => item.itemId === "scroll_reinforce")?.id;
  const potionId = second.snapshot().items.find((item) => item.itemId === "potion_hp_s")?.id;
  check("sword instance loaded", Boolean(swordId));
  check("fang instance loaded", Boolean(fangId));
  check("enchant instance loaded", Boolean(enchantId));
  check("reinforce instance loaded", Boolean(reinforceId));
  check("spare sword loaded", Boolean(first.snapshot().items.some((item) => item.id === spareSwordId)));
  check("potion instance loaded", Boolean(potionId));
  if (!swordId || !fangId || !enchantId || !reinforceId || !potionId) {
    throw new Error("required granted items are missing from the loaded inventory");
  }

  const previewPromise = nextMessage(first.room, "upgradePreview");
  const blacksmithErrorPromise = nextMessage(first.room, "blacksmithError").catch(() => null);
  send(first.room, "requestUpgradePreview", { instanceId: swordId });
  const preview = await Promise.race([previewPromise, blacksmithErrorPromise.then((error) => {
    if (error) throw new Error(`blacksmith error ${JSON.stringify(error)}`);
    return null;
  })]);
  check("blacksmith preview chance", preview?.chance === 0.7, String(preview?.chance));
  check("blacksmith preview cost", preview?.gold === 8000, String(preview?.gold));

  const resultPromise = nextMessage(first.room, "upgradeResult");
  send(first.room, "upgradeItem", { instanceId: swordId, useBlessing: false });
  const upgrade = await resultPromise;
  check("upgrade result delivered", Boolean(upgrade) && upgrade.previousLevel === 3);
  check(
    "upgrade outcome consistent",
    upgrade.success ? upgrade.level === 4 : upgrade.level === null,
  );

  const appliedPromise = nextMessage(first.room, "bonusScrollApplied");
  send(first.room, "applyBonusScroll", {
    scrollInstanceId: enchantId,
    itemInstanceId: spareSwordId,
  });
  const applied = await appliedPromise;
  check("enchant applies bonuses", applied?.kind === "enchant" && applied.bonuses.length >= 1);

  const reinforcedPromise = nextMessage(first.room, "bonusScrollApplied");
  send(first.room, "applyBonusScroll", {
    scrollInstanceId: reinforceId,
    itemInstanceId: spareSwordId,
  });
  const reinforced = await reinforcedPromise;
  check("reinforce appends a bonus", reinforced?.kind === "reinforce");

  const invitePromise = nextMessage(second.room, "tradeInvite");
  send(first.room, "tradeInvite", { characterId: two.character.id });
  const invite = await invitePromise;
  check("trade invite delivered", Boolean(invite?.tradeId));

  const firstState = nextMessage(first.room, "tradeState");
  const secondState = nextMessage(second.room, "tradeState");
  send(second.room, "tradeRespond", { tradeId: invite.tradeId, accept: true });
  await Promise.all([firstState, secondState]);

  send(first.room, "tradeOffer", {
    tradeId: invite.tradeId,
    revision: 0,
    instanceIds: [fangId],
    gold: 100,
  });
  await wait(150);
  send(second.room, "tradeOffer", {
    tradeId: invite.tradeId,
    revision: 1,
    instanceIds: [potionId],
    gold: 50,
  });
  await wait(150);
  send(first.room, "tradeLock", { tradeId: invite.tradeId, revision: 2, locked: true });
  await wait(100);
  send(second.room, "tradeLock", { tradeId: invite.tradeId, revision: 2, locked: true });
  await wait(100);
  send(first.room, "tradeAccept", { tradeId: invite.tradeId, revision: 2 });
  const firstInventory = nextMessage(first.room, "inventory");
  const secondInventory = nextMessage(second.room, "inventory");
  send(second.room, "tradeAccept", { tradeId: invite.tradeId, revision: 2 });
  const [afterFirst, afterSecond] = await Promise.all([firstInventory, secondInventory]);
  check(
    "trade swaps items",
    afterFirst.items.some((item) => item.itemId === "potion_hp_s") &&
      afterSecond.items.some((item) => item.itemId === "material_wolf_fang"),
  );
  check("trade moves gold", afterFirst.gold === 241_950 && afterSecond.gold === 250_050);

  const itemLogs = await api("/api/admin/logs/item?q=trade", { token: adminToken });
  check("trade item logs written", (itemLogs.data?.entries ?? []).length > 0);
  const tradeLogs = await api("/api/admin/logs/trade", { token: adminToken });
  check("trade log written", (tradeLogs.data?.entries ?? []).length > 0);

  const dataset = await api("/api/admin/data/items", { token: adminToken });
  const basePotion = dataset.data?.merged?.find((entry) => entry.id === "potion_hp_s");
  const saved = await api("/api/admin/data/items/potion_hp_s", {
    method: "PUT",
    token: adminToken,
    body: { payload: { ...basePotion, buyPrice: 777 } },
  });
  check("admin override saves", saved.status === 200, String(saved.status));
  const catalog = await api("/api/data/catalog");
  const hotPotion = catalog.data?.entries?.items?.find((entry) => entry.id === "potion_hp_s");
  check("catalog reflects override without restart", hotPotion?.buyPrice === 777);
  const reverted = await api("/api/admin/data/items/potion_hp_s", {
    method: "DELETE",
    token: adminToken,
  });
  check("admin override reverts", reverted.status === 200, String(reverted.status));

  await first.room.leave();
  await second.room.leave();
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nPhase 7 E2E: PASS" : `\nPhase 7 E2E: ${failures} failure(s)`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error("\nPhase 7 E2E crashed:", error);
    process.exit(1);
  });
