#!/usr/bin/env node
/**
 * Dev database helper, run by `pnpm dev:db` (`node --env-file-if-exists=.env`).
 *
 * Two modes, driven by POSTGRES_HOST:
 * - localhost + Docker installed: `docker compose up -d --wait`, so the
 *   AGENTS.md promise "pnpm dev starts Postgres (Docker)" holds for setups
 *   that run everything locally.
 * - remote host (our Raspberry Pi): a TCP reachability check with a clear
 *   message instead.
 *
 * This script is NEVER fatal: even when the database is unreachable the
 * phase-0/pre-phase-2 dev stack works, `/api/health` reports
 * `db: "unavailable"` and the client badge shows it.
 */
import { spawnSync } from "node:child_process";
import net from "node:net";

const host = process.env.POSTGRES_HOST ?? "localhost";
const port = Number(process.env.POSTGRES_PORT ?? 5432);

function tcpProbe(targetHost, targetPort, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: targetHost, port: targetPort });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish({ ok: false, reason: "timeout" }));
    socket.once("connect", () => finish({ ok: true }));
    socket.once("error", (err) => finish({ ok: false, reason: err.code ?? String(err) }));
  });
}

const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(host);

if (isLocalHost) {
  const dockerAvailable = spawnSync("docker", ["compose", "version"], { shell: true }).status === 0;
  if (!dockerAvailable) {
    console.log(
      "[dev-db] Docker is not installed here and POSTGRES_HOST is local; skipping container start.",
    );
    console.log('[dev-db] Postgres is expected to run remotely; /api/health will report db: "unavailable".');
  } else {
    console.log("[dev-db] starting local dev Postgres via docker compose...");
    const up = spawnSync("docker", ["compose", "up", "-d", "--wait"], { shell: true, stdio: "inherit" });
    if (up.status !== 0) {
      console.warn("[dev-db] docker compose did not come up healthy; continuing anyway.");
    }
  }
} else {
  const probe = await tcpProbe(host, port);
  if (probe.ok) {
    console.log(`[dev-db] Postgres at ${host}:${port} reachable ✓`);
  } else {
    console.warn(
      `[dev-db] Postgres at ${host}:${port} NOT reachable (${probe.reason}); continuing anyway.`,
    );
    console.log('[dev-db] /api/health will report db: "unavailable" until the database is up.');
  }
}

process.exit(0);
