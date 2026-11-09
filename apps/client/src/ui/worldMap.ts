import type { MapPolicy } from "@jadethrone/data/mapPolicies";

export interface WorldMapNode {
  mapId: string;
  label: string;
  x: number;
  y: number;
  current: boolean;
  connections: string[];
}

/**
 * Fixed layout mirroring the travel graph: kingdom villages on the left, their
 * highlands in the middle, the neutral Valley/Forest/Cave branch on the right.
 */
const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  map_ember_village: { x: 0, y: 0 },
  map_ember_fields: { x: 150, y: 0 },
  map_corrupted_forest: { x: 300, y: 0 },
  map_gale_village: { x: 0, y: 70 },
  map_gale_highlands: { x: 150, y: 70 },
  map_valley_of_echoes: { x: 300, y: 70 },
  map_tide_village: { x: 0, y: 140 },
  map_tide_highlands: { x: 150, y: 140 },
  map_spider_cave: { x: 300, y: 140 },
};

export function worldMapNodes(
  policies: readonly MapPolicy[],
  currentMapId: string | null,
): WorldMapNode[] {
  return policies.map((policy, index) => {
    const position = NODE_POSITIONS[policy.mapId] ?? {
      x: (index % 3) * 150,
      y: Math.floor(index / 3) * 70,
    };
    return {
      mapId: policy.mapId,
      label: policy.label,
      x: position.x,
      y: position.y,
      current: policy.mapId === currentMapId,
      connections: [...policy.connections],
    };
  });
}
