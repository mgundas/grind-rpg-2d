import { randomUUID } from "node:crypto";
import type { Db, Tx } from "../db/client";
import { adminLog } from "../db/schema";

export interface AdminLogInput {
  actorAccountId: string;
  action: string;
  targetAccountId?: string | null;
  targetCharacterId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/** Values for an `admin_log` insert, usable inside an existing transaction. */
export function adminLogValues(input: AdminLogInput) {
  return {
    id: randomUUID(),
    actorAccountId: input.actorAccountId,
    action: input.action,
    targetAccountId: input.targetAccountId ?? null,
    targetCharacterId: input.targetCharacterId ?? null,
    detail: input.detail ?? {},
    ip: input.ip ?? null,
  };
}

/** Best-effort audit write; callers that mutate DB rows should pass their tx. */
export async function writeAdminLog(
  db: Db | Tx,
  input: AdminLogInput,
): Promise<void> {
  await db.insert(adminLog).values(adminLogValues(input));
}
