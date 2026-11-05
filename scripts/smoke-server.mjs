#!/usr/bin/env node
/**
 * Headless smoke test for the game server.
 *
 * Boots the server, polls `GET /api/health` until it answers, prints the
 * payload, kills the process tree and exits 0 (healthy) or 1 (timeout).
 *
 * Killing a nested pnpm -> tsx -> node chain on Windows needs
 * `taskkill /F /T` (see DECISIONS.md D7).
 *
 * Usage:
 *   node scripts/smoke-server.mjs             # boots src via tsx (dev)
 *   node scripts/smoke-server.mjs --dist      # boots the built dist bundle
 *   node scripts/smoke-server.mjs --port 2567
 */
import { spawn } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);

const portFlag = args.indexOf("--port");
const port = portFlag !== -1 ? Number(args[portFlag + 1]) : 2567;
const useDist = args.includes("--dist");

const command = useDist
  ? "node apps/server/dist/index.cjs"
  : "pnpm --filter @jadethrone/server exec tsx src/app.config.ts";
const targetUrl = `http://127.0.0.1:${port}/api/health`;

console.log(`[smoke] booting: ${command}`);
const child = spawn(command, { shell: true, stdio: "inherit" });

function killTree(pid) {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForHealth(deadlineMs) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // not up yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`server did not answer ${targetUrl} within ${deadlineMs}ms`);
}

try {
  const payload = await waitForHealth(20000);
  console.log(JSON.stringify({ smoke: "ok", payload }));
} catch (error) {
  console.error(`[smoke] FAILED: ${String(error)}`);
  process.exitCode = 1;
} finally {
  killTree(child.pid);
  // give the tree a moment to die before the exit code is read
  setTimeout(() => process.exit(process.exitCode ?? 0), 1000);
}
