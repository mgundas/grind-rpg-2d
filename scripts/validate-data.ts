#!/usr/bin/env node
/**
 * Data validation entrypoint (GAME_DESIGN.md §10.6).
 *
 * Every dataset is Zod-validated at import, and `BASE_CATALOG` additionally
 * checks cross-dataset references (items↔drops↔shops↔NPCs, monsters↔drops,
 * skills↔doctrines, stones/spawn groups↔monsters). Running this script is the
 * fast standalone check; the same rules run in `pnpm test` via the 15 suites in
 * `packages/data/test`.
 */
import { BASE_CATALOG } from "../packages/data/src/catalog.ts";
import { MAP_JSON } from "../packages/data/src/maps.ts";
import { getMapPolicy } from "../packages/data/src/mapPolicies.ts";
import { hasSpawnGroup } from "../packages/data/src/spawnGroups.ts";
import {
  MAP_IDS,
  extractMapObjects,
  parseTiledMap,
  type MapId,
} from "../packages/shared/src/index.ts";

const datasets = {
  items: BASE_CATALOG.items.length,
  monsters: BASE_CATALOG.monsters.length,
  dropTables: BASE_CATALOG.dropTables.length,
  shops: BASE_CATALOG.shops.length,
  npcs: BASE_CATALOG.npcs.length,
  skills: BASE_CATALOG.skills.length,
  stones: BASE_CATALOG.stones.length,
  spawnGroups: BASE_CATALOG.spawnGroups.length,
  upgrades: BASE_CATALOG.maxUpgradeLevel + 1,
  bonuses: BASE_CATALOG.bonusPool.length,
};

for (const [dataset, count] of Object.entries(datasets)) {
  if (count <= 0) {
    throw new Error(`dataset "${dataset}" is empty`);
  }
  console.log(`ok ${dataset}: ${count}`);
}

// Every map parses, has a policy, and only references known spawn groups/maps.
for (const mapId of MAP_IDS) {
  getMapPolicy(mapId);
  const objects = extractMapObjects(parseTiledMap(MAP_JSON[mapId]));
  for (const zone of objects.mobZones) {
    if (!hasSpawnGroup(zone.spawnGroupId)) {
      throw new Error(`map "${mapId}": unknown spawn group "${zone.spawnGroupId}"`);
    }
  }
  for (const warp of objects.warps) {
    if (!(MAP_IDS as readonly MapId[]).includes(warp.targetMap)) {
      throw new Error(`map "${mapId}": unknown warp target "${warp.targetMap}"`);
    }
  }
}
console.log(`ok maps: ${MAP_IDS.length}`);
console.log(`data catalog v${BASE_CATALOG.version} validated`);
