#!/usr/bin/env node
/**
 * Phase-5 live acceptance helper. Requires the dev stack (`pnpm dev`, which
 * includes Postgres and the server) and a seeded admin account (`pnpm seed`).
 *
 * Covers the admin flow that needs a real server: admin login (REST + monitor
 * cookie), dashboard presence, giving a +5 sword to an online player,
 * a live announcement banner, banning (kick + 403 login), unbanning, monitor
 * cookie authorization and the admin/item audit log.
 *
 * Usage:
 *   pnpm seed
 *   pnpm verify:phase5-e2e
 *   E2E_SERVER_URL=ws://host:2567 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
 *     node scripts/verify-phase5-e2e.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("../apps/client/node_modules/@colyseus/sdk");

const WS_URL = process.env.E2E_SERVER_URL ?? "ws://localhost:2567";
const HTTP_URL = WS_URL.replace(/^ws/, "http").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-please-8-chars";
const PASSWORD = "correct-horse-battery";
const SWORD = "sword_ember_t1";

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
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await wait(25);
  }
}

async function api(path, { method = "GET", body, token, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
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
  return { status: response.status, data, text, headers: response.headers };
}

function readAdminCookie(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const value of cookies) {
    const match = /^jt_admin=([^;]+)/.exec(value);
    if (match) {
      return `jt_admin=${match[1]}`;
    }
  }
  return null;
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

async function main() {
  // 1. Admin login also sets the HttpOnly monitor cookie.
  const adminLogin = await api("/api/auth/login", {
    method: "POST",
    body: { login: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (adminLogin.status !== 200) {
    throw new Error(
      `admin login failed (${adminLogin.status}). Run "pnpm seed" or set ADMIN_EMAIL/ADMIN_PASSWORD.`,
    );
  }
  const admin = adminLogin.data;
  const adminToken = admin.tokens.accessToken;
  const monitorCookie = readAdminCookie(adminLogin);
  check("seed admin logs in", admin.account.role === "admin" || admin.account.role === "gm");
  check("admin login sets the monitor cookie", Boolean(monitorCookie));

  // 2. Dashboard works with the admin token and nobody else.
  const unauthorized = await api("/api/admin/dashboard");
  check("admin API rejects missing tokens", unauthorized.status === 401);

  const id = suffix();
  const creds = {
    email: `e2e5${id}@example.com`,
    username: `E5${id}`,
    password: PASSWORD,
    kingdom: "ember",
  };
  const registered = await api("/api/auth/register", { method: "POST", body: creds });
  if (registered.status !== 201) {
    throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.data)}`);
  }
  const player = registered.data;
  const playerToken = player.tokens.accessToken;
  const character = await createCharacter(player, `E5${suffix()}`);

  const forbidden = await api("/api/admin/dashboard", { token: playerToken });
  check("admin API rejects player roles", forbidden.status === 403);

  const dashboard = await api("/api/admin/dashboard", { token: adminToken });
  check("admin dashboard loads", dashboard.status === 200 && Boolean(dashboard.data.server));

  // 3. Put the player online and confirm presence.
  const session = await join(playerToken, character);
  let dashboardOnline = null;
  await waitUntil(async () => {
    dashboardOnline = await api("/api/admin/dashboard", { token: adminToken });
    return (
      dashboardOnline.status === 200 &&
      dashboardOnline.data.online.players.some((row) => row.characterId === character.id)
    );
  }, 8000);
  check(
    "online player appears in the admin dashboard",
    dashboardOnline.data.online.players.some((row) => row.characterId === character.id),
  );

  // 4. Give a +5 sword; the live session must receive it.
  const inventoryBefore = session.getInventory();
  check(
    "player starts without the granted sword",
    !inventoryBefore.items.some((item) => item.itemId === SWORD && item.upgradeLevel === 5),
  );
  const granted = new Promise((resolve) => {
    const off = session.room.onMessage("inventory", (payload) => {
      if (payload.items.some((item) => item.itemId === SWORD && item.upgradeLevel === 5)) {
        off();
        resolve(payload);
      }
    });
  });
  const give = await api(`/api/admin/players/${character.id}/items`, {
    method: "POST",
    token: adminToken,
    body: { definitionId: SWORD, quantity: 1, upgradeLevel: 5, bonuses: [] },
  });
  check("admin item grant returns 201", give.status === 201, String(give.status));
  const inventoryAfter = await granted;
  check(
    "the live player receives the +5 sword",
    inventoryAfter.items.some((item) => item.itemId === SWORD && item.upgradeLevel === 5),
  );

  // 5. Announcement reaches the live session.
  const message = `Phase5 E2E ${id}`;
  const banner = new Promise((resolve) => {
    const off = session.room.onMessage("announcement", (payload) => {
      off();
      resolve(payload);
    });
  });
  const announcement = await api("/api/admin/announcements", {
    method: "POST",
    token: adminToken,
    body: { message, intervalMinutes: null },
  });
  check("announcement create returns 201", announcement.status === 201);
  const announced = await Promise.race([banner, wait(4000).then(() => null)]);
  check(
    "the live player sees the announcement banner",
    Boolean(announced) && announced.message === message && announced.kind === "admin",
  );

  // 6. Ban kicks the session and blocks login until unbanned.
  const kicked = new Promise((resolve) => {
    session.room.onMessage("sessionKicked", resolve);
  });
  const ban = await api(`/api/admin/players/${character.id}/ban`, {
    method: "POST",
    token: adminToken,
    body: { durationMinutes: 60, reason: "Phase 5 E2E" },
  });
  check("ban returns a bannedUntil timestamp", ban.status === 200 && Boolean(ban.data.bannedUntil));
  const kick = await Promise.race([kicked, wait(4000).then(() => null)]);
  check("ban kicks the online player", kick?.reason === "ban");

  const bannedLogin = await api("/api/auth/login", {
    method: "POST",
    body: { login: creds.email, password: PASSWORD },
  });
  check("banned accounts cannot log in", bannedLogin.status === 403, String(bannedLogin.status));

  const unban = await api(`/api/admin/accounts/${player.account.id}/unban`, {
    method: "POST",
    token: adminToken,
  });
  check("unban succeeds", unban.status === 200);
  const rebannedLogin = await api("/api/auth/login", {
    method: "POST",
    body: { login: creds.email, password: PASSWORD },
  });
  check("unbanned accounts can log in again", rebannedLogin.status === 200);

  // 7. The Colyseus monitor is protected by the admin cookie.
  const monitorWithout = await api("/colyseus/");
  check("monitor rejects unauthenticated requests", monitorWithout.status === 401);
  const monitorWith = await api("/colyseus/", { cookie: monitorCookie });
  check(
    "monitor accepts the admin cookie",
    monitorWith.status === 200 && monitorWith.text.includes("<"),
  );

  // 8. Admin and item audit logs contain the actions above.
  const adminLogs = await api("/api/admin/logs/admin?q=account_ban", { token: adminToken });
  check(
    "admin log records the ban",
    adminLogs.status === 200 &&
      adminLogs.data.entries.some(
        (row) => row.action === "account_ban" && row.characterId === character.id,
      ),
  );
  const itemLogs = await api(
    `/api/admin/logs/item?characterId=${character.id}&q=admin_grant`,
    { token: adminToken },
  );
  check(
    "item log records the grant",
    itemLogs.status === 200 &&
      itemLogs.data.entries.some((row) => row.definitionId === SWORD),
  );

  await session.room.leave().catch(() => {});
}

try {
  await main();
} catch (error) {
  console.error(error);
  failures += 1;
}

if (failures > 0) {
  console.error(`\n${failures} Phase-5 live check(s) failed.`);
  process.exit(1);
}
console.log("\nAll Phase-5 live checks passed.");
