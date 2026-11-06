import { isHealthPayload, type HealthPayload } from "@jadethrone/shared";

/**
 * HTTP helpers for the client overlay. Phase 0 only exposes the health
 * probe; the game socket (Colyseus room join) arrives in Phase 1.
 */

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
    return isHealthPayload(body) ? body : null;
  } catch {
    return null;
  }
}
