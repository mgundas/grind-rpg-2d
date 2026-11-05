import type { RequestHandler } from "express";
import { Client } from "pg";
import { config } from "../config";

export interface HealthPayload {
  status: "ok";
  uptimeSeconds: number;
  db: "up" | "unavailable";
}

/**
 * pg's connectionTimeoutMillis does not always cover a hanging DNS lookup
 * (observed with an unreachable mDNS name on Windows), so the health
 * endpoint races the ping against a hard deadline. A late-arriving ping
 * result resolves on its own and is ignored; the short-lived client closes
 * in its own `finally`.
 */
const HEALTH_DB_DEADLINE_MS = 2000;

function delay(ms: number): Promise<"unavailable"> {
  return new Promise((resolve) => setTimeout(() => resolve("unavailable"), ms));
}

/** Open a short-lived client and verify the database answers. Never throws. */
async function pingDatabase(): Promise<"up" | "unavailable"> {
  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return "up";
  } catch {
    return "unavailable";
  } finally {
    try {
      await client.end();
    } catch {
      // client.end() can fail if the connection never opened; nothing to do.
    }
  }
}

export const healthHandler: RequestHandler = async (_req, res) => {
  const db = await Promise.race([pingDatabaseOnce(), delay(HEALTH_DB_DEADLINE_MS)]);
  const payload: HealthPayload = {
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    db,
  };
  res.json(payload);
};

/**
 * Singleflight pool: hung pings (e.g. slow DNS) must not pile up one pg
 * client per health request when monitors poll this endpoint aggressively.
 */
let pingInFlight: Promise<"up" | "unavailable"> | null = null;

function pingDatabaseOnce(): Promise<"up" | "unavailable"> {
  if (pingInFlight) {
    return pingInFlight;
  }
  pingInFlight = pingDatabase().finally(() => {
    pingInFlight = null;
  });
  return pingInFlight;
}
