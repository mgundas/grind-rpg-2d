#!/usr/bin/env node
/**
 * Phase-9 live acceptance helper. Requires `pnpm dev` + Postgres.
 *
 * Covers: character creation, waykeeper travel from Ember Village to Ember
 * Highlands, channel persistence across that warp, and an in-game channel
 * switch on the same map.
 *
 * Usage: pnpm verify:phase9-e2e
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("../apps/client/node_modules/@colyseus/sdk");

const WS_URL = process.env.E2E_SERVER_URL ?? "ws://localhost:2567";
const HTTP_URL = WS_URL.replace(/^ws/, "http").replace(/\/$/, "");
const PASSWORD = "correct-horse-battery";
const KINGDOM = "ember";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = () => Math.random().toString(36).slice(2, 8);
let failures = 0;

function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures += 1;
}

async function waitUntil(predicate, timeoutMs = 8000, label = "condition") {
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

function nextMessage(room, type, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
    room.onMessage(type, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function main() {
  const name = `P9${suffix()}`;
  const email = `${name.toLowerCase()}@example.com`;
  const register = await api("/api/auth/register", {
    method: "POST",
    body: { email, username: name, password: PASSWORD, kingdom: KINGDOM },
  });
  check("register", register.status === 201, String(register.status));
  const access = register.data?.tokens?.accessToken;
  check("access token issued", typeof access === "string");
  if (!access) process.exit(1);

  const created = await api("/api/characters", {
    method: "POST",
    token: access,
    body: { name, classId: "warrior", gender: "male", hairStyle: 0, hairColor: 0 },
  });
  check("create character", created.status === 201, String(created.status));
  const character = created.data?.character;
  if (!character) process.exit(1);

  const client = new Client(WS_URL);
  client.auth.token = access;
  let room = await client.joinOrCreate("map_ember_village", {
    characterId: character.id,
    map: "map_ember_village",
    channel: 1,
  });
  await waitUntil(() => room.sessionId !== undefined, 8000, "room join");
  check("joined Ember Village on CH1", room.roomId !== undefined);

  const dialog = nextMessage(room, "npcDialog");
  room.send("interactNpc", { npcId: "waykeeper" });
  const npc = await dialog;
  const destinations = npc.destinations ?? [];
  check(
    "waykeeper offers Ember Highlands",
    destinations.some((entry) => entry.mapId === "map_ember_fields"),
    destinations.map((entry) => entry.mapId).join(","),
  );

  const warp = nextMessage(room, "warp");
  room.send("teleportRequest", { npcId: "waykeeper", targetMap: "map_ember_fields" });
  const toHighlands = await warp;
  check("teleported to Ember Highlands", toHighlands.map === "map_ember_fields");
  check("warp preserved CH1", toHighlands.channel === 1);
  await room.leave(false);
  room = await client.consumeSeatReservation(toHighlands.reservation);
  await waitUntil(() => room.sessionId !== undefined, 8000, "highlands join");
  check("arrived in the highlands room", room.roomId !== undefined);

  // Arrival arms the 2 s anti-ping-pong cooldown; wait it out before switching.
  await wait(2300);
  const switched = nextMessage(room, "warp");
  room.send("channelSwitch", { channel: 2 });
  const channelWarp = await switched;
  check("channel switch stays on the same map", channelWarp.map === "map_ember_fields");
  check("channel switch targets CH2", channelWarp.channel === 2);
  await room.leave(false);
  room = await client.consumeSeatReservation(channelWarp.reservation);
  await waitUntil(() => room.sessionId !== undefined, 8000, "channel 2 join");
  check("arrived in a CH2 room", room.roomId !== undefined);

  await room.leave(false);
  return failures;
}

main()
  .then((failed) => {
    if (failed > 0) {
      console.error(`\n${failed} Phase-9 E2E check(s) failed.`);
      process.exit(1);
    }
    console.log("\nPhase-9 E2E passed.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
