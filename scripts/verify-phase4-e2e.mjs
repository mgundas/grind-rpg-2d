#!/usr/bin/env node
/**
 * Phase-4 live acceptance helper. Requires `pnpm dev` (Postgres + server) and
 * creates disposable accounts/characters.
 *
 * Covers: starter inventory/gold, walking to an NPC, buying and selling at a
 * shop, and depositing/withdrawing a warehouse item on a second character of
 * the same account. Drops/combat are covered by the room tests and the economy
 * script; this script focuses on the economy flow that needs a real session.
 *
 * Usage:
 *   node scripts/verify-phase4-e2e.mjs
 *   E2E_SERVER_URL=ws://host:2567 node scripts/verify-phase4-e2e.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("../apps/client/node_modules/@colyseus/sdk");

const WS_URL = process.env.E2E_SERVER_URL ?? "ws://localhost:2567";
const HTTP_URL = WS_URL.replace(/^ws/, "http").replace(/\/$/, "");
const PASSWORD = "correct-horse-battery";
const GENERAL_GOODS = { x: 38 * 32 + 16, y: 38 * 32 + 16 };
const WAREHOUSE = { x: 38 * 32 + 16, y: 42 * 32 + 16 };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = () => Math.random().toString(36).slice(2, 8);

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) {
    failures += 1;
  }
}

async function waitUntil(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
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

async function createCharacter(auth, name) {
  const result = await api("/api/characters", {
    method: "POST",
    token: auth.tokens.accessToken,
    body: { name, classId: "warrior", gender: "male", hairStyle: 0, hairColor: 0 },
  });
  if (result.status !== 201) {
    throw new Error(`create character failed: ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result.data.character;
}

function self(room) {
  return room.state?.players?.get(room.sessionId);
}

async function join(accessToken, character) {
  const client = new Client(WS_URL);
  client.auth.token = accessToken;
  const room = await client.joinOrCreate(character.map, {
    characterId: character.id,
    map: character.map,
  });
  await waitUntil(() => Boolean(room.state?.players) && Boolean(self(room)));
  let inventory = null;
  room.onMessage("inventory", (payload) => {
    inventory = payload;
  });
  room.send("requestInventory", {});
  await waitUntil(() => Boolean(inventory));
  return { room, getInventory: () => inventory };
}

let inputSeq = 1;

async function walkTo(room, target) {
  const seq = ++inputSeq;
  room.send("input", { seq, kind: "path", x: target.x, y: target.y });
  await waitUntil(() => {
    const own = self(room);
    return own && Math.hypot(own.x - target.x, own.y - target.y) < 70;
  }, 12_000);
}

async function main() {
  const id = suffix();
  const creds = {
    email: `e2e${id}@example.com`,
    username: `E2e${id}`,
    password: PASSWORD,
    kingdom: "ember",
  };
  const registered = await api("/api/auth/register", { method: "POST", body: creds });
  if (registered.status !== 201) {
    throw new Error(`register failed: ${registered.status}`);
  }
  const auth = registered.data;
  const first = await createCharacter(auth, `Inv${suffix()}`);
  const second = await createCharacter(auth, `Sto${suffix()}`);

  const a = await join(auth.tokens.accessToken, first);
  const starter = a.getInventory();
  check("starter kit gives gold", starter.gold >= 500, `${starter.gold}`);
  check(
    "starter kit equips a weapon",
    starter.equipment.some((item) => item && item.itemId.startsWith("sword_")),
  );
  check("starter kit includes potions", starter.items.some((item) => item.itemId === "potion_hp_s"));

  await walkTo(a.room, GENERAL_GOODS);
  const dialog = new Promise((resolve) => a.room.onMessage("npcDialog", resolve));
  a.room.send("interactNpc", { npcId: "general_goods" });
  const npc = await dialog;
  check("general goods dialog opens", npc.shopId === "general_goods");

  const beforeBuy = a.getInventory();
  const bought = new Promise((resolve) => a.room.onMessage("inventory", resolve));
  a.room.send("shopBuy", { shopId: "general_goods", itemId: "potion_hp_s", quantity: 1 });
  const afterBuy = await bought;
  check("buying a potion debits gold", afterBuy.gold === beforeBuy.gold - 40);
  const potion = afterBuy.items.find((item) => item.itemId === "potion_hp_s");
  check("buying a potion adds it", Boolean(potion));

  const sold = new Promise((resolve) => a.room.onMessage("inventory", resolve));
  a.room.send("shopSell", { instanceId: potion.id, quantity: 1 });
  const afterSell = await sold;
  check("selling a potion credits gold", afterSell.gold === afterBuy.gold + 12);

  await walkTo(a.room, WAREHOUSE);
  const opened = new Promise((resolve) => a.room.onMessage("warehouse", resolve));
  a.room.send("warehouseOpen", { npcId: "warehouse_keeper" });
  await opened;
  const deposit = new Promise((resolve) => a.room.onMessage("warehouse", resolve));
  a.room.send("warehouseDeposit", { instanceId: potion.id });
  const stored = await deposit;
  check("deposit stores the potion", stored.items.some((item) => item.id === potion.id));

  await a.room.leave();

  const b = await join(auth.tokens.accessToken, second);
  await walkTo(b.room, WAREHOUSE);
  const reopened = new Promise((resolve) => b.room.onMessage("warehouse", resolve));
  b.room.send("warehouseOpen", { npcId: "warehouse_keeper" });
  const warehouse = await reopened;
  check(
    "second character sees the account warehouse",
    warehouse.items.some((item) => item.id === potion.id),
  );

  const withdrawn = new Promise((resolve) => b.room.onMessage("inventory", resolve));
  b.room.send("warehouseWithdraw", { instanceId: potion.id });
  const afterWithdraw = await withdrawn;
  check(
    "second character withdraws the potion",
    afterWithdraw.items.some((item) => item.id === potion.id),
  );

  await b.room.leave();
}

try {
  await main();
} catch (error) {
  console.error(error);
  failures += 1;
}

if (failures > 0) {
  console.error(`\n${failures} Phase-4 live check(s) failed.`);
  process.exit(1);
}
console.log("\nAll Phase-4 live checks passed.");
