import type { RequestHandler } from "express";
import { Client } from "pg";
import { config } from "../config";

export interface HealthPayload {
  status: "ok";
  uptimeSeconds: number;
  db: "up" | "unavailable";
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
      // client.end() can fail if the connection never opened — health output
      // was already produced by module load.
    }
  }
}

export const healthHandler: RequestHandler = async (_req, res) => {
  const payload: HealthPayload = {
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    db: await pingDatabase(),
  };
  res.json(payload);
};
