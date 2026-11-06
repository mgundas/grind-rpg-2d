#!/usr/bin/env node
/**
 * Phase-2 acceptance check against a running stack (`pnpm dev` or the server).
 *
 * Covers: register → create character → join → walk → log out → log in →
 * character saved at the same position/map → second login kicks the first
 * session → stale token cannot rejoin → delete character → logout.
 *
 * Usage:
 *   node scripts/verify-phase2-e2e.mjs
 *   E2E_SERVER_URL=ws://host:2567 node scripts/verify-phase2-e2e.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("../apps/client/node_modules/@colyseus/sdk");

const WS_URL = process.env.E2E_SERVER_URL ?? "ws://localhost:2567";
const HTTP_URL = WS_URL.replace(/^ws/, "http").replace(/\/$/, "");
const PASSWORD = "correct-horse-battery";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = () => Math.random().toString(36).slice(2, 8);

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) {
    failures += 1;
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

function accounts() {
  const id = suffix();
  return {
    email: `e2e${id}@example.com`,
    username: `E2e${id}`,
    password: PASSWORD,
    kingdom: "ember",
  };
}

async function register(creds) {
  const result = await api("/api/auth/register", { method: "POST", body: creds });
  if (result.status !== 201) {
    throw new Error(`register failed: ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function login(creds) {
  const result = await api("/api/auth/login", {
    method: "POST",
    body: { login: creds.email, password: creds.password },
  });
  if (result.status !== 200) {
    throw new Error(`login failed: ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function createCharacter(auth, name) {
  const result = await api("/api/characters", {
    method: "POST",
    token: auth.tokens.accessToken,
    body: { name, classId: "warrior", gender: "male", hairStyle: 1, hairColor: 2 },
  });
  if (result.status !== 201) {
    throw new Error(`create character failed: ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result.data.character;
}

function self(room) {
  return room.state.players.get(room.sessionId);
}

let firstRoom = null;
let kickingRoom = null;

try {
  const creds = accounts();
  const name = `E2e${suffix()}`;
  const registered = await register(creds);
  check("register returns tokens", Boolean(registered.tokens?.accessToken));
  check("new account has no characters", registered.characters.length === 0);

  const character = await createCharacter(registered, name);
  check("character created", character.name === name);
  check("character starts in the village", character.map === "map_ember_village");

  // --- join and walk -------------------------------------------------------
  const clientA = new Client(WS_URL);
  clientA.auth.token = registered.tokens.accessToken;
  firstRoom = await clientA.joinOrCreate(character.map, {
    characterId: character.id,
    map: character.map,
  });
  await wait(500);
  const own = self(firstRoom);
  check("own player is visible", Boolean(own));
  check("character id matches", own?.characterId === character.id);
  check("appearance is synced", own?.classId === "warrior" && own?.hairStyle === 1);

  const startX = own.x;
  const startY = own.y;
  for (let seq = 1; seq <= 5; seq++) {
    firstRoom.send("input", { seq, kind: "dir", dir: 0 });
    await wait(60);
  }
  firstRoom.send("input", { seq: 6, kind: "none" });
  await wait(500);
  const afterWalk = self(firstRoom);
  const moved = Math.abs(afterWalk.x - startX) + Math.abs(afterWalk.y - startY) > 1;
  check("walking moves the authoritative character", moved);

  const savedPosition = { x: afterWalk.x, y: afterWalk.y, map: character.map };
  await firstRoom.leave();
  await wait(700);
  firstRoom = null;

  // --- log in again, position persisted -----------------------------------
  const loggedIn = await login(creds);
  const listed = await api("/api/characters", { token: loggedIn.tokens.accessToken });
  const reloaded = listed.data.characters.find((candidate) => candidate.id === character.id);
  check("character still exists after logout", Boolean(reloaded));
  check(
    "saved position matches the last authoritative position",
    reloaded &&
      Math.abs(reloaded.x - savedPosition.x) < 2 &&
      Math.abs(reloaded.y - savedPosition.y) < 2,
    `${reloaded?.x?.toFixed?.(1)}, ${reloaded?.y?.toFixed?.(1)}`,
  );
  check("saved map matches", reloaded?.map === savedPosition.map);

  const clientB = new Client(WS_URL);
  clientB.auth.token = loggedIn.tokens.accessToken;
  kickingRoom = await clientB.joinOrCreate(reloaded.map, {
    characterId: reloaded.id,
    map: reloaded.map,
  });
  await wait(500);
  const rejoined = self(kickingRoom);
  check(
    "rejoin spawns at the saved position",
    rejoined &&
      Math.abs(rejoined.x - savedPosition.x) < 2 &&
      Math.abs(rejoined.y - savedPosition.y) < 2,
  );

  // --- second login kicks the first session -------------------------------
  let kickedReason = null;
  let leaveCode = null;
  const kicked = new Promise((resolve) => {
    kickingRoom.onMessage("sessionKicked", (payload) => {
      kickedReason = payload.reason;
      resolve();
    });
    kickingRoom.onLeave((code) => {
      leaveCode = code;
      resolve();
    });
  });

  const secondLogin = await login(creds);
  await Promise.race([kicked, wait(4000)]);
  check(
    "second login kicks the first session",
    kickedReason === "login" || leaveCode === 4100,
    `reason=${kickedReason} code=${leaveCode}`,
  );

  // Old access token must not be able to rejoin after the version bump.
  const staleClient = new Client(WS_URL);
  staleClient.auth.token = loggedIn.tokens.accessToken;
  let staleRejected = false;
  try {
    const room = await staleClient.joinOrCreate(reloaded.map, {
      characterId: reloaded.id,
      map: reloaded.map,
    });
    await room.leave();
  } catch {
    staleRejected = true;
  }
  check("stale access token is rejected", staleRejected);

  // --- delete + logout -----------------------------------------------------
  const deleted = await api(`/api/characters/${reloaded.id}`, {
    method: "DELETE",
    token: secondLogin.tokens.accessToken,
  });
  check("character delete returns 204", deleted.status === 204);

  const afterDelete = await api("/api/characters", {
    token: secondLogin.tokens.accessToken,
  });
  check(
    "character list is empty after delete",
    Array.isArray(afterDelete.data.characters) && afterDelete.data.characters.length === 0,
  );

  const logout = await api("/api/auth/logout", {
    method: "POST",
    body: { refreshToken: secondLogin.tokens.refreshToken },
  });
  check("logout returns 204", logout.status === 204);

  console.log(failures === 0 ? "\nPHASE 2 E2E PASS" : `\nPHASE 2 E2E FAIL (${failures})`);
} catch (error) {
  console.error("\nPHASE 2 E2E ERROR", error);
  process.exitCode = 1;
} finally {
  const leaves = [firstRoom?.leave?.(), kickingRoom?.leave?.()].filter(Boolean);
  // A kicked room's leave promise may never settle; never block process exit.
  await Promise.race([Promise.allSettled(leaves), wait(2000)]);
  process.exitCode = process.exitCode ?? (failures > 0 ? 1 : 0);
}
