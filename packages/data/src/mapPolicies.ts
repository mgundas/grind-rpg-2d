import { z } from "zod";
import { MAP_IDS, type MapId } from "@jadethrone/shared";
import raw from "../maps/policies.json";

/**
 * Per-map social/environment policy. Kept in data so Phase 9 can add maps
 * without touching combat/chat code. PvP is allowed only on non-safe maps;
 * neutral maps suppress cross-kingdom chat scrambling.
 */
export const WEATHER_KINDS = ["none", "leaves", "rain"] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export interface MapPolicy {
  mapId: MapId;
  label: string;
  pvpAllowed: boolean;
  neutral: boolean;
  safe: boolean;
  weather: WeatherKind;
  connections: MapId[];
  minimapScale: number;
}

const policySchema = z
  .object({
    mapId: z.enum(MAP_IDS),
    label: z.string().min(1).max(64),
    pvpAllowed: z.boolean(),
    neutral: z.boolean(),
    safe: z.boolean(),
    weather: z.enum(WEATHER_KINDS),
    connections: z.array(z.enum(MAP_IDS)),
    minimapScale: z.number().min(0.5).max(8),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.safe && policy.pvpAllowed) {
      ctx.addIssue({ code: "custom", message: `${policy.mapId}: safe maps cannot allow PvP` });
    }
    if (new Set(policy.connections).size !== policy.connections.length) {
      ctx.addIssue({ code: "custom", message: `${policy.mapId}: duplicate connection` });
    }
    if (policy.connections.includes(policy.mapId)) {
      ctx.addIssue({ code: "custom", message: `${policy.mapId}: cannot connect to itself` });
    }
  });

const fileSchema = z
  .object({
    version: z.literal(1),
    maps: z.array(policySchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const policy of file.maps) {
      if (seen.has(policy.mapId)) {
        ctx.addIssue({ code: "custom", message: `duplicate map policy "${policy.mapId}"` });
      }
      seen.add(policy.mapId);
    }
    for (const mapId of MAP_IDS) {
      if (!seen.has(mapId)) {
        ctx.addIssue({ code: "custom", message: `missing map policy "${mapId}"` });
      }
    }
  });

export function buildMapPolicies(rawJson: unknown): readonly MapPolicy[] {
  return fileSchema.parse(rawJson).maps;
}

export const MAP_POLICIES: readonly MapPolicy[] = buildMapPolicies(raw);

const byMap = new Map(MAP_POLICIES.map((policy) => [policy.mapId, policy]));

export function getMapPolicy(mapId: MapId): MapPolicy {
  const policy = byMap.get(mapId);
  if (!policy) {
    throw new Error(`unknown map policy "${mapId}"`);
  }
  return policy;
}
