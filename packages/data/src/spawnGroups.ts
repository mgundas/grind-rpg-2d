import { z } from "zod";
import raw from "../spawnGroups.json";
import { hasMonster } from "./monsters";

/**
 * Spawn groups referenced by the Tiled `mob_zone` objects (GAME_DESIGN.md §6.1).
 * A group is 3–7 monsters around an optional leader; the field boss is a single
 * member with a long respawn. Counts are validated here; placement and timing
 * are server runtime concerns.
 */
const memberSchema = z.object({
  monsterId: z.string().min(1),
  count: z.number().int().min(1).max(10),
  leader: z.boolean().optional(),
});

const groupSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, "group ids are lower_snake_case"),
    members: z.array(memberSchema).min(1).max(10),
    respawnMinMs: z.number().int().min(1000),
    respawnMaxMs: z.number().int().min(1000),
  })
  .superRefine((group, ctx) => {
    if (group.respawnMaxMs < group.respawnMinMs) {
      ctx.addIssue({
        code: "custom",
        message: "respawnMaxMs must be >= respawnMinMs",
        path: ["respawnMaxMs"],
      });
    }
    if (group.members.filter((member) => member.leader).length > 1) {
      ctx.addIssue({ code: "custom", message: "a group has at most one leader", path: ["members"] });
    }
    const total = group.members.reduce((sum, member) => sum + member.count, 0);
    if (total < 1 || total > 10) {
      ctx.addIssue({
        code: "custom",
        message: `group size must be 1–10, got ${total}`,
        path: ["members"],
      });
    }
    for (const [index, member] of group.members.entries()) {
      if (!hasMonster(member.monsterId)) {
        ctx.addIssue({
          code: "custom",
          message: `unknown monster "${member.monsterId}"`,
          path: ["members", index, "monsterId"],
        });
      }
    }
  });

const spawnGroupsFileSchema = z
  .object({
    version: z.literal(1),
    groups: z.array(groupSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    for (const [index, group] of file.groups.entries()) {
      if (ids.has(group.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate spawn group id "${group.id}"`,
          path: ["groups", index, "id"],
        });
      }
      ids.add(group.id);
    }
  });

const parsed = spawnGroupsFileSchema.parse(raw);

export interface SpawnMember {
  monsterId: string;
  count: number;
  leader?: boolean;
}

export interface SpawnGroupInfo {
  id: string;
  members: SpawnMember[];
  respawnMinMs: number;
  respawnMaxMs: number;
}

export const SPAWN_GROUPS: readonly SpawnGroupInfo[] = parsed.groups;

const byId = new Map(SPAWN_GROUPS.map((group) => [group.id, group]));

export function hasSpawnGroup(id: string): boolean {
  return byId.has(id);
}

export function getSpawnGroup(id: string): SpawnGroupInfo {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown spawn group "${id}"`);
  }
  return found;
}
