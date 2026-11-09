import type { MapPolicy } from "@jadethrone/data/mapPolicies";

export interface WorldMapNode {
  mapId: string;
  label: string;
  x: number;
  y: number;
  current: boolean;
  connections: string[];
}

/** Stable simple layout for the Phase 8 two-map world; Phase 9 can supply real coordinates. */
export function worldMapNodes(
  policies: readonly MapPolicy[],
  currentMapId: string | null,
): WorldMapNode[] {
  return policies.map((policy, index) => ({
    mapId: policy.mapId,
    label: policy.label,
    x: (index % 2) * 210,
    y: Math.floor(index / 2) * 120,
    current: policy.mapId === currentMapId,
    connections: [...policy.connections],
  }));
}
