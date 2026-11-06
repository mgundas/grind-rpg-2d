#!/usr/bin/env node
/**
 * Phase-1 acceptance check against a running dev stack (`pnpm dev`).
 *
 * Phase 2 removed guest joins, so this script registers two accounts and
 * creates a character for each before joining. It verifies:
 *  - two authenticated clients join map_ember_village and see each other,
 *  - an input sequence moves the player, is acknowledged, and the other client
 *    receives the updated remote position,
 *  - local chat is delivered,
 *  - click-to-move reaches the village→fields warp, the reservation is
 *    consumed, and the return warp brings the client back.
 *
 * Usage: node scripts/verify-phase1-e2e.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("../apps/client/node_modules/@colyseus/sdk");

const URL = process.env.E2E_SERVER_URL ?? "ws://localhost:2567";
const HTTP = URL.replace(/^ws/, "http").replace(/\/$/, "");
const VILLAGE = "map_ember_village";
const FIELDS = "map_ember_fields";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = () => Math.random().toString(36).slice(2, 8);

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) {
    failures += 1;
  }
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${HTTP}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

async function makePlayer(label) {
  const id = suffix();
  const creds = {
    email: `p1${id}@example.com`,
    username: `P1${id}`,
    password: "correct-horse-battery",
    kingdom: "ember",
  };
  const registered = await api("/api/auth/register", { method: "POST", body: creds });
  if (registered.status !== 201) {
    throw new Error(`register ${label} failed: ${registered.status}`);
  }
  const created = await api("/api/characters", {
    method: "POST",
    token: registered.data.tokens.accessToken,
    body: {
      name: `${label}${suffix()}`.slice(0, 16),
      classId: "warrior",
      gender: "male",
      hairStyle: 0,
      hairColor: 0,
    },
  });
  if (created.status !== 201) {
    throw new Error(`character ${label} failed: ${created.status}`);
  }
  const client = new Client(URL);
  client.auth.token = registered.data.tokens.accessToken;
  return { client, character: created.data.character, creds };
}

const rooms = [];

try {
  const alpha = await makePlayer("Alpha");
  const beta = await makePlayer("Beta");
  const roomA = await alpha.client.joinOrCreate(VILLAGE, {
    characterId: alpha.character.id,
    map: VILLAGE,
  });
  const roomB = await beta.client.joinOrCreate(VILLAGE, {
    characterId: beta.character.id,
    map: VILLAGE,
  });
  rooms.push(roomA, roomB);
  // The sender also receives its own chat echo; consume it without a warning.
  roomA.onMessage("chatMsg", () => undefined);
  await wait(400);

  check("own player is visible", Boolean(roomA.state.players.get(roomA.sessionId)));
  check("other player is visible", Boolean(roomB.state.players.get(roomA.sessionId)));

  const startX = roomA.state.players.get(roomA.sessionId).x;
  for (let seq = 1; seq <= 5; seq++) {
    roomA.send("input", { seq, kind: "dir", dir: 0 });
  }
  await wait(600);
  const moved = roomA.state.players.get(roomA.sessionId);
  check("movement acknowledged", moved.lastSeq >= 5);
  check("movement applied", moved.x > startX);
  await wait(300);
  const remoteCopy = roomB.state.players.get(roomA.sessionId);
  check(
    "other client receives the remote position",
    Boolean(remoteCopy) && Math.abs(remoteCopy.x - moved.x) < 0.01,
  );

  const chatPromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    roomB.onMessage("chatMsg", (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
  roomA.send("chat", { text: "hello from Alpha" });
  const chat = await chatPromise;
  check("local chat delivered", chat?.text === "hello from Alpha");

  // --- village -> fields warp via click-to-move ---------------------------
  const gamma = await makePlayer("Gamma");
  const roomC = await gamma.client.joinOrCreate(VILLAGE, {
    characterId: gamma.character.id,
    map: VILLAGE,
  });
  rooms.push(roomC);
  await wait(300);

  const warpPromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 20000);
    roomC.onMessage("warp", (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
  // The village east warp is at x=2368..2432, y=1216..1376; the server's A*
  // routes around houses and the river.
  roomC.send("input", { seq: 1, kind: "path", x: 2400, y: 1296 });
  const warp = await warpPromise;
  check("warp to fields issued", warp?.map === FIELDS);
  check("warp target is the fields spawn", warp?.x === 176 && warp?.y === 2576);

  await roomC.leave();
  let fieldsRoom = null;
  if (warp?.reservation) {
    try {
      fieldsRoom = await gamma.client.consumeSeatReservation(warp.reservation);
      rooms.push(fieldsRoom);
      await wait(400);
    } catch (error) {
      console.error("consume first warp failed:", error);
    }
  }
  const arrival = fieldsRoom?.state.players.get(fieldsRoom.sessionId);
  check("warp reservation consumed", Boolean(fieldsRoom));
  check("arrived on the fields map", Boolean(arrival));

  // --- fields -> village return warp --------------------------------------
  if (fieldsRoom) {
    const backPromise = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 10000);
      fieldsRoom.onMessage("warp", (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
    for (let seq = 1; seq <= 16; seq++) {
      fieldsRoom.send("input", { seq, kind: "dir", dir: 4 });
      await wait(50);
    }
    const back = await backPromise;
    check("return warp to village issued", back?.map === VILLAGE);
    await fieldsRoom.leave();
    let villageRoom = null;
    if (back?.reservation) {
      try {
        villageRoom = await gamma.client.consumeSeatReservation(back.reservation);
        rooms.push(villageRoom);
        await wait(400);
      } catch (error) {
        console.error("consume return warp failed:", error);
      }
    }
    check("return warp consumed", Boolean(villageRoom));
    check(
      "arrived back in the village",
      Boolean(villageRoom?.state.players.get(villageRoom.sessionId)),
    );

    // Persistence across a warp: leave, log in again, and read the saved map.
    await villageRoom?.leave();
    await wait(500);
    const relogin = await api("/api/auth/login", {
      method: "POST",
      body: { login: gamma.creds.email, password: gamma.creds.password },
    });
    const listed = await api("/api/characters", {
      token: relogin.data.tokens.accessToken,
    });
    const saved = listed.data.characters.find((candidate) => candidate.id === gamma.character.id);
    check("warp destination is persisted", saved?.map === VILLAGE);
    check(
      "post-warp position is persisted",
      saved && Math.abs(saved.x - 1296) < 2 && Math.abs(saved.y - 1296) < 2,
      `${saved?.x?.toFixed?.(1)}, ${saved?.y?.toFixed?.(1)}`,
    );
  }

  console.log(failures === 0 ? "\nPHASE 1 E2E PASS" : `\nPHASE 1 E2E FAIL (${failures})`);
} catch (error) {
  console.error("\nPHASE 1 E2E ERROR", error);
  process.exitCode = 1;
} finally {
  const leaves = rooms.map((room) => room.leave()).filter(Boolean);
  await Promise.race([Promise.allSettled(leaves), wait(2500)]);
  process.exitCode = process.exitCode ?? (failures > 0 ? 1 : 0);
}
