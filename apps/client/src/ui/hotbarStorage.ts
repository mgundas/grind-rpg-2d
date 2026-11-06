const SLOT_COUNT = 8;
const KEY_PREFIX = "jt.hotbar.";

/** Persisted hotbar binding: item definition id or null. */
export type HotbarBindings = (string | null)[];

function empty(): HotbarBindings {
  return Array.from({ length: SLOT_COUNT }, () => null);
}

export function loadHotbar(characterId: string | null): HotbarBindings {
  if (!characterId) {
    return empty();
  }
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${characterId}`);
    if (!raw) {
      return empty();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return empty();
    }
    return Array.from({ length: SLOT_COUNT }, (_, index) =>
      typeof parsed[index] === "string" ? (parsed[index] as string) : null,
    );
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
