const SLOT_COUNT = 8;
const KEY_PREFIX = "jt.hotbar.";

/** A hotbar slot can hold an item definition or a learned skill. */
export interface HotbarBinding {
  kind: "item" | "skill";
  id: string;
}

export type HotbarBindings = (HotbarBinding | null)[];

function empty(): HotbarBindings {
  return Array.from({ length: SLOT_COUNT }, () => null);
}

function binding(value: unknown): HotbarBinding | null {
  if (typeof value === "string") {
    // Phase 5 saves stored bare item ids.
    return { kind: "item", id: value };
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { kind?: unknown; id?: unknown };
  if (
    (record.kind === "item" || record.kind === "skill") &&
    typeof record.id === "string" &&
    record.id.length > 0
  ) {
    return { kind: record.kind, id: record.id };
  }
  return null;
}

/** Parse a stored hotbar value, including the Phase 5 string format. */
export function parseHotbar(raw: string | null): HotbarBindings {
  if (!raw) {
    return empty();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return empty();
    }
    return Array.from({ length: SLOT_COUNT }, (_, index) => binding(parsed[index]));
  } catch {
    return empty();
  }
}

export function loadHotbar(characterId: string | null): HotbarBindings {
  if (!characterId) {
    return empty();
  }
  try {
    return parseHotbar(localStorage.getItem(`${KEY_PREFIX}${characterId}`));
  } catch {
    return empty();
  }
}

export function saveHotbar(characterId: string | null, bindings: HotbarBindings): void {
  if (!characterId) {
    return;
  }
  try {
    localStorage.setItem(`${KEY_PREFIX}${characterId}`, JSON.stringify(bindings));
  } catch {
    // Storage may be unavailable; the hotbar still works for this session.
  }
}

export const HOTBAR_SLOT_COUNT = SLOT_COUNT;
