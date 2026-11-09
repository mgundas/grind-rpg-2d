#!/usr/bin/env node
/**
 * Phase-10 load test: 150 bots walking and attacking on one channel.
 *
 * Requires the dev stack (Postgres + game server) to be running:
 *   pnpm dev
 *   pnpm verify:phase10-load
 *
 * Bots are real SDK clients joined through the real `onAuth` path. Accounts and
 * characters are seeded straight into the database (the HTTP register route is
 * rate-limited to a handful per IP), tokens are minted with the configured
 * secret, and everything with the run prefix is deleted afterwards.
 *
 * PASS requires >=95% joins and a tick p95 below 20 ms over the measured
 * window (the server's own instrumentation, sampled from /api/admin/server).
 */
import process from "node:process";
import { randomUUID } from "node:crypto";
import { eq, like } from "../apps/server/node_modules/drizzle-orm";
import { Client, type Room } from "@colyseus/sdk";
import { MAP_JSON } from "../packages/data/src/maps";
import { extractMapObjects, parseTiledMap } from "../packages/shared/src/tiled";
import { config } from "../apps/server/src/config";
import { getDb, closeDb } from "../apps/server/src/db/client";
import { accounts, characters } from "../apps/server/src/db/schema";
import { hashPassword } from "../apps/server/src/auth/passwords";
import { signAccessToken } from "../apps/server/src/auth/tokens";
import { createCharacter } from "../apps/server/src/characters/characterService";

const MAP = "map_ember_fields";
const CHANNEL = 1;
const HTTP_URL = (process.env.E2E_SERVER_URL ?? "http://127.0.0.1:2567").replace(/\/$/, "");
const WS_URL = process.env.E2E_WS_URL ?? HTTP_URL.replace(/^http/, "ws");
const PASS_P95_MS = 20;
const PASS_JOIN_RATE = 0.95;

/** Drops bots across the map's mob zones so combat and AI are exercised. */
function botSpawns(count: number): Array<{ x: number; y: number }> {
  const map = parseTiledMap(MAP_JSON[MAP]);
  const zones = extractMapObjects(map).mobZones;
  if (zones.length === 0) {
    return Array.from({ length: count }, () => ({ x: 400, y: 400 }));
  }
  return Array.from({ length: count }, (_, index) => {
    const zone = zones[index % zones.length]!;
    const angle = (index % 12) * (Math.PI / 6);
    return {
      x: zone.x + zone.w / 2 + Math.cos(angle) * 80,
      y: zone.y + zone.h / 2 + Math.sin(angle) * 80,
    };
  });
}

interface Args {
  bots: number;
  duration: number;
  warmup: number;
  joinRate: number;
}

function parseArgs(): Args {
  const args: Args = { bots: 150, duration: 45, warmup: 8, joinRate: 25 };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.split("=");
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    if (key === "--bots") args.bots = Math.max(1, Math.floor(numeric));
    if (key === "--duration") args.duration = Math.max(5, Math.floor(numeric));
    if (key === "--warmup") args.warmup = Math.max(0, Math.floor(numeric));
    if (key === "--join-rate") args.joinRate = Math.max(1, numeric);
  }
  return args;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface MonsterLike {
  x: number;
  y: number;
}

interface PlayerLike {
  x: number;
  y: number;
}

interface RoomStateLike {
  monsters?: { forEach(callback: (monster: MonsterLike, id: string) => void): void };
  players?: {
    get(id: string): PlayerLike | undefined;
  };
}

interface Bot {
  client: Client;
  room: Room;
  seq: number;
  lastInputAt: number;
  nextInputMs: number;
  lastAttackAt: number;
  nextAttackMs: number;
  lastTargetAt: number;
  left: boolean;
}

interface StatusSample {
  atMs: number;
  p95Ms: number;
  avgMs: number;
  players: number;
  overruns: number;
}

function randomDir(): number {
  return Math.floor(Math.random() * 8);
}

async function adminToken(): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ id: accounts.id, tokenVersion: accounts.tokenVersion })
    .from(accounts)
    .where(eq(accounts.email, config.seedAdminEmail))
    .limit(1);
  if (!row) {
    throw new Error(`admin account ${config.seedAdminEmail} not found; run pnpm seed`);
  }
  return signAccessToken({
    accountId: row.id,
    tokenVersion: row.tokenVersion,
    secret: config.jwtAccessSecret,
    ttlSeconds: 3600,
  });
}

async function status(token: string): Promise<{
  rooms: Array<{
    roomId: string;
    players: number;
    p95Ms: number;
    avgMs: number;
    overruns: number;
  }>;
}> {
  const res = await fetch(`${HTTP_URL}/api/admin/server`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET /api/admin/server failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    tick?: {
      rooms: Array<{
        roomId: string;
        players: number;
        p95Ms: number;
        avgMs: number;
        overruns: number;
      }>;
    };
  };
  return { rooms: body.tick?.rooms ?? [] };
}

async function seedAccounts(bots: number): Promise<{
  prefix: string;
  rows: Array<{ accountId: string; characterId: string; token: string }>;
}> {
  const db = getDb();
  const runId = Date.now().toString(36).slice(-5);
  const prefix = `loadbot_${runId}`;
  const passwordHash = await hashPassword("load-bot-password");
  const accountRows = Array.from({ length: bots }, (_, index) => ({
    id: randomUUID(),
    email: `${prefix}_${index}@example.com`,
    username: `Lb${runId}${index}`.slice(0, 16),
    passwordHash,
    kingdom: "ember" as const,
    role: "player" as const,
    tokenVersion: 0,
  }));

  for (let index = 0; index < accountRows.length; index += 50) {
    await db.insert(accounts).values(accountRows.slice(index, index + 50));
  }
  process.stdout.write(`seeded ${bots} accounts\n`);

  const rows: Array<{ accountId: string; characterId: string; token: string }> = [];
  const characterIds: string[] = [];
  for (let index = 0; index < accountRows.length; index++) {
    const account = accountRows[index]!;
    const character = await createCharacter(db, account.id, {
      name: `LB${runId}${index}`.slice(0, 16),
      classId: "warrior",
      gender: "male",
      hairStyle: 0,
      hairColor: 0,
    });
    characterIds.push(character.id);
    rows.push({
      accountId: account.id,
      characterId: character.id,
      token: signAccessToken({
        accountId: account.id,
        tokenVersion: 0,
        secret: config.jwtAccessSecret,
        ttlSeconds: 3600,
      }),
    });
    if ((index + 1) % 25 === 0) {
      process.stdout.write(`created ${index + 1}/${bots} characters\n`);
    }
  }

  const spawns = botSpawns(characterIds.length);
  for (let index = 0; index < characterIds.length; index++) {
    await db
      .update(characters)
      .set({ mapId: MAP, channel: CHANNEL, x: spawns[index]!.x, y: spawns[index]!.y })
      .where(eq(characters.id, characterIds[index]!));
  }
  return { prefix, rows };
}

async function joinBot(row: { characterId: string; token: string }): Promise<Bot> {
  const client = new Client(WS_URL);
  client.auth.token = row.token;
  const room = await client.joinOrCreate(MAP, {
    characterId: row.characterId,
    map: MAP,
    channel: CHANNEL,
  });
  const bot: Bot = {
    client,
    room,
    seq: 0,
    lastInputAt: 0,
    nextInputMs: 220 + Math.random() * 180,
    lastAttackAt: 0,
    nextAttackMs: 850 + Math.random() * 400,
    lastTargetAt: 0,
    left: false,
  };
  room.onLeave(() => {
    bot.left = true;
  });
  return bot;
}

function nearestMonster(bot: Bot): MonsterLike | null {
  const state = bot.room.state as unknown as RoomStateLike;
  const own = state.players?.get(bot.room.sessionId);
  if (!own || !state.monsters) {
    return null;
  }
  let best: MonsterLike | null = null;
  let bestDistance = 320 * 320;
  state.monsters.forEach((monster) => {
    const dx = monster.x - own.x;
    const dy = monster.y - own.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = monster;
    }
  });
  return best;
}

function monstersInState(bot: Bot): number {
  const state = bot.room.state as unknown as RoomStateLike;
  let count = 0;
  state.monsters?.forEach(() => {
    count++;
  });
  return count;
}

function driveBots(bots: Bot[], now: number): void {
  for (const bot of bots) {
    if (now - bot.lastInputAt >= bot.nextInputMs) {
      bot.lastInputAt = now;
      bot.nextInputMs = 220 + Math.random() * 180;
      bot.seq++;
      try {
        bot.room.send("input", { seq: bot.seq, kind: "dir", dir: randomDir() });
      } catch {
        // A bot that died or left is skipped; the metric only needs the rest.
      }
    }
    if (now - bot.lastAttackAt >= bot.nextAttackMs) {
      bot.lastAttackAt = now;
      bot.nextAttackMs = 850 + Math.random() * 400;
      try {
        bot.room.send("attack", { dir: randomDir() });
      } catch {
        // Same as above.
      }
    }
    // A third of the bots exercise server-driven click-to-attack pathfinding.
    if (now - bot.lastTargetAt >= 3000 && Math.random() < 0.3) {
      bot.lastTargetAt = now;
      const monster = nearestMonster(bot);
      if (monster) {
        try {
          const state = bot.room.state as unknown as {
            monsters?: { forEach(callback: (m: MonsterLike, id: string) => void): void };
          };
          let targetId: string | null = null;
          if (state.monsters) {
            let nearest = 320 * 320;
            const own = (bot.room.state as unknown as RoomStateLike).players?.get(
              bot.room.sessionId,
            );
            if (own) {
              state.monsters.forEach((m, id) => {
                const dx = m.x - own.x;
                const dy = m.y - own.y;
                const distance = dx * dx + dy * dy;
                if (distance < nearest) {
                  nearest = distance;
                  targetId = id;
                }
              });
            }
          }
          if (targetId) {
            bot.room.send("setTarget", { monsterId: targetId });
          }
        } catch {
          // Ignore bots whose room state is not ready yet.
        }
      }
    }
  }
}

async function main(): Promise<number> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed load-test accounts with NODE_ENV=production");
  }
  const args = parseArgs();
  const db = getDb();
  const token = await adminToken();

  const bots: Bot[] = [];
  let prefix = "";
  let joinFailures = 0;
  try {
    const seeded = await seedAccounts(args.bots);
    prefix = seeded.prefix;
    const rows = seeded.rows;
    process.stdout.write(`joining ${args.bots} bots at ${args.joinRate}/s on ${MAP} CH${CHANNEL}\n`);
    const joinDelay = 1000 / args.joinRate;
    for (let index = 0; index < rows.length; index++) {
      try {
        bots.push(await joinBot(rows[index]!));
      } catch (error) {
        joinFailures++;
        if (joinFailures <= 3) {
          console.error(`join ${index} failed:`, error instanceof Error ? error.message : error);
        }
      }
      await wait(joinDelay);
    }
    const joinRate = bots.length / args.bots;
    process.stdout.write(
      `joined ${bots.length}/${args.bots} (${(joinRate * 100).toFixed(1)}%)\n`,
    );
    if (bots.length === 0) {
      throw new Error("no bots joined");
    }
    const roomId = bots[0]!.room.roomId;
    process.stdout.write(`room ${roomId}\n`);

    const drive = setInterval(() => driveBots(bots, Date.now()), 100);
    const samples: StatusSample[] = [];
    const poll = setInterval(() => {
      void status(token)
        .then((body) => {
          const room = body.rooms.find((entry) => entry.roomId === roomId);
          if (room) {
            samples.push({
              atMs: Date.now(),
              p95Ms: room.p95Ms,
              avgMs: room.avgMs,
              players: room.players,
              overruns: room.overruns,
            });
          }
        })
        .catch(() => undefined);
    }, 1000);

    const measureStart = Date.now() + args.warmup * 1000;
    const measureEnd = measureStart + args.duration * 1000;
    process.stdout.write(
      `warmup ${args.warmup}s, measuring ${args.duration}s...\n`,
    );
    while (Date.now() < measureEnd) {
      await wait(250);
    }
    clearInterval(drive);
    clearInterval(poll);
    await wait(1200);

    const measured = samples.filter((sample) => sample.atMs >= measureStart);
    const worstP95 = measured.reduce((max, sample) => Math.max(max, sample.p95Ms), 0);
    const meanP95 =
      measured.length > 0
        ? measured.reduce((sum, sample) => sum + sample.p95Ms, 0) / measured.length
        : 0;
    const peakPlayers = measured.reduce((max, sample) => Math.max(max, sample.players), 0);
    const totalOverruns = measured.reduce((sum, sample) => sum + sample.overruns, 0);
    const avgTick =
      measured.length > 0
        ? measured.reduce((sum, sample) => sum + sample.avgMs, 0) / measured.length
        : 0;

    console.log("");
    console.log(`join rate         ${(joinRate * 100).toFixed(1)}% (${bots.length}/${args.bots})`);
    console.log(`tick samples      ${measured.length}`);
    console.log(`players in room   peak ${peakPlayers}`);
    console.log(`tick avg          ${avgTick.toFixed(2)} ms`);
    console.log(`tick p95 mean     ${meanP95.toFixed(2)} ms`);
    console.log(`tick p95 worst    ${worstP95.toFixed(2)} ms`);
    console.log(`overruns (>50ms)  ${totalOverruns}`);
    console.log(`monsters visible  ${bots.length > 0 ? monstersInState(bots[0]!) : 0}`);
    console.log(`bots that left    ${bots.filter((bot) => bot.left).length}`);
    const firstState = bots[0]!.room.state as unknown as RoomStateLike;
    const own = firstState.players?.get(bots[0]!.room.sessionId);
    console.log(`bot[0] position   ${own ? `${own.x.toFixed(0)},${own.y.toFixed(0)}` : "unknown"}`);

    let failures = 0;
    const fail = (label: string): void => {
      failures++;
      console.log(`FAIL ${label}`);
    };
    if (joinRate < PASS_JOIN_RATE) fail(`join rate ${(joinRate * 100).toFixed(1)}%`);
    if (measured.length < Math.max(5, Math.floor(args.duration * 0.6))) {
      fail(`only ${measured.length} tick samples`);
    }
    if (worstP95 >= PASS_P95_MS) fail(`worst tick p95 ${worstP95.toFixed(2)} ms >= ${PASS_P95_MS}`);
    if (peakPlayers < Math.ceil(args.bots * PASS_JOIN_RATE)) {
      fail(`peak room players ${peakPlayers} below ${Math.ceil(args.bots * PASS_JOIN_RATE)}`);
    }
    if (failures === 0) {
      console.log("\nPhase-10 load test passed.");
    }
    return failures;
  } finally {
    await Promise.allSettled(bots.map((bot) => bot.room.leave(true)));
    await wait(500);
    if (prefix) {
      try {
        await db.delete(accounts).where(like(accounts.email, `${prefix}%`));
      } catch (error) {
        console.error("cleanup failed, retrying once:", error);
        await wait(1000);
        try {
          await db.delete(accounts).where(like(accounts.email, `${prefix}%`));
        } catch (retryError) {
          console.error("cleanup failed (delete loadbot accounts manually):", retryError);
        }
      }
    }
    await closeDb();
  }
}

main()
  .then((failures) => {
    if (failures > 0) {
      console.error(`\n${failures} Phase-10 load check(s) failed.`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
