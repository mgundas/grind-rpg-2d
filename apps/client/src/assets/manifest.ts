/**
 * Asset manifest types, fetching and strict validation.
 *
 * The manifest maps logical asset keys (e.g. `char.body.male`) to file paths
 * plus a placeholder spec (see GAME_DESIGN.md §2.1). Missing files fall back
 * to procedural placeholders at preload time — game code only ever sees
 * texture keys. See `assets/placeholders.ts` and `docs/plans/phase-0.md` §8.
 */

export type PlaceholderKind = "char" | "mob" | "icon" | "tileset" | "portrait";

export interface PlaceholderSpec {
  kind: PlaceholderKind;
  /** Body color for char/mob placeholders. */
  color?: string;
  /** Rarity color key (from RARITY_COLORS) for icon placeholders. */
  rarity?: string;
  /** First two letters drawn on icon placeholders. */
  label?: string;
  /** Tile kinds in order for tileset placeholders (index = tile id). */
  tiles?: string[];
}

export interface AssetEntry {
  /** Path relative to /assets/. */
  path: string;
  placeholder: PlaceholderSpec;
}

export interface AssetManifest {
  version: number;
  assets: Record<string, AssetEntry>;
}

export async function fetchAssetManifest(): Promise<AssetManifest> {
  const res = await fetch("/assets/manifest.json");
  if (!res.ok) {
    throw new Error(`GET /assets/manifest.json failed: HTTP ${res.status}`);
  }
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    throw new Error("/assets/manifest.json is not valid JSON");
  }
  return parseAssetManifest(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KNOWN_KINDS = new Set<PlaceholderKind>(["char", "mob", "icon", "tileset", "portrait"]);

function parseEntry(key: string, value: unknown): AssetEntry {
  if (!isRecord(value)) {
    throw new Error(`asset "${key}" must be an object`);
  }
  if (typeof value.path !== "string" || value.path.length === 0) {
    throw new Error(`asset "${key}" needs a non-empty string "path"`);
  }
  if (!isRecord(value.placeholder)) {
    throw new Error(`asset "${key}" needs a "placeholder" spec object`);
  }
  const rawSpec = value.placeholder;
  const kind = rawSpec.kind;
  if (typeof kind !== "string" || !KNOWN_KINDS.has(kind as PlaceholderKind)) {
    throw new Error(
      `asset "${key}" has unknown placeholder kind "${String(kind)}" (expected one of ${[...KNOWN_KINDS].join(", ")})`,
    );
  }
  const spec: PlaceholderSpec = { kind: kind as PlaceholderKind };
  if (typeof rawSpec.color === "string") spec.color = rawSpec.color;
  if (typeof rawSpec.rarity === "string") spec.rarity = rawSpec.rarity;
  if (typeof rawSpec.label === "string") spec.label = rawSpec.label;
  if (Array.isArray(rawSpec.tiles)) {
    spec.tiles = rawSpec.tiles.filter((t): t is string => typeof t === "string");
  }
  return { path: value.path, placeholder: spec };
}

/** Strict shape validation; throws a readable list of errors. */
export function parseAssetManifest(value: unknown): AssetManifest {
  if (!isRecord(value)) {
    throw new Error("manifest root must be an object");
  }
  if (typeof value.version !== "number") {
    throw new Error('manifest "version" must be a number');
  }
  if (!isRecord(value.assets)) {
    throw new Error('manifest "assets" must be an object');
  }
  const errors: string[] = [];
  const assets: Record<string, AssetEntry> = {};
  for (const [key, rawEntry] of Object.entries(value.assets)) {
    try {
      assets[key] = parseEntry(key, rawEntry);
    } catch (error) {
      errors.push(String(error));
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid manifest.json:\n${errors.join("\n")}`);
  }
  return { version: value.version, assets };
}
