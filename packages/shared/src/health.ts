/** Shape of the server's `GET /api/health` response (single source of truth). */
export interface HealthPayload {
  status: "ok";
  uptimeSeconds: number;
  db: "up" | "unavailable";
}

/** Narrow guard for the payload, usable on both server and client. */
export function isHealthPayload(value: unknown): value is HealthPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    body.status === "ok" &&
    typeof body.uptimeSeconds === "number" &&
    (body.db === "up" || body.db === "unavailable")
  );
}
