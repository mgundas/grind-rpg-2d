#!/usr/bin/env node
/**
 * Phase-1 acceptance check against a running dev stack (`pnpm dev`).
 *
 * Verifies, with the real Colyseus SDK:
 *  - two guest clients join map_ember_village and see each other (StateView),
 *  - an input sequence moves the player, is acknowledged, and the other client
 *    receives the updated remote position,
 *  - local chat is delivered to the other player,
 *  - a client that walks onto the fields->village warp receives a reservation,
 *    leaves the old room, consumes it, and spawns on the target map.
 *
 * Usage: node scripts/verify-phase1-e2e.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("../apps/client/node_modules/@colyseus/sdk");

const URL = process.env.E2E_SERVER_URL ?? "ws://localhost:2567";
const VILLAGE = "map_ember_village";
const FIELDS = "map_ember_fields";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) {
    process.exitCode = 1;
  }
}

const a = new Client(URL);
const b = new Client(URL);
const roomA = await a.joinOrCreate(VILLAGE, { name: "Alpha" });
const roomB = await b.joinOrCreate(VILLAGE, { name: "Beta" });
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

const c = new Client(URL);
const roomC = await c.joinOrCreate(FIELDS, { name: "Gamma" });
await wait(200);
const warpPromise = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 15000);
  roomC.onMessage("warp", (payload) => {
    clearTimeout(timer);
    resolve(payload);
  });
});
// Walk west into the fields return warp at the real input rate (20/s).
for (let seq = 1; seq <= 16; seq++) {
  roomC.send("input", { seq, kind: "dir", dir: 4 });
  await wait(50);
}
const warp = await warpPromise;
check("warp to village issued", warp?.map === VILLAGE);
check("warp target is the village spawn", warp?.x === 1296 && warp?.y === 1296);

// Mirror the real client path: leave the old room, consume the reservation,
// then verify the authoritative spawn on the target map.
await roomC.leave();
let arrivalRoom = null;
try {
  arrivalRoom = await c.consumeSeatReservation(warp.reservation);
  await wait(400);
} catch (error) {
  console.error("consumeSeatReservation failed:", error);
}
const arrival = arrivalRoom?.state.players.get(arrivalRoom.sessionId);
check("warp reservation consumed", Boolean(arrivalRoom));
check("arrived on the village map", Boolean(arrival));
check("arrived at the village spawn", arrival?.x === 1296 && arrival?.y === 1296);

await roomA.leave();
await roomB.leave();
await arrivalRoom?.leave();
process.exit(process.exitCode ?? 0);
