/**
 * HTTP helpers for the client overlay. Phase 0 only exposes the health
 * probe; the game socket (Colyseus room join) arrives in Phase 1.
 */

/** Mirrors the server payload (`apps/server/src/routes/health.ts`). */
export interface HealthPayload {
  status: "ok";
  uptimeSeconds: number;
  db: "up" | "unavailable";
}

/**
 * GET /api/health through the Vite dev proxy. Resolves null on any failure
 * (server down, non-2xx, malformed body) — callers only need "did the
 * server answer" for the status badge.
 */
export async function getHealth(): Promise<HealthPayload | null> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) {
      return null;
    }
    const body: unknown = await res.json();
    if (isHealthPayload(body)) {
      return body;
    }
    return null;
  } catch {
    return null;
  }
}

function isHealthPayload(value: unknown): value is HealthPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return body.status === "ok" && typeof body.uptimeSeconds === "number";
}
