/**
 * Central keybinding map (GAME_DESIGN.md §5 and §10.4).
 *
 * Keys are stored in a normalized, layout-friendly form derived from
 * `KeyboardEvent.key`: letters lower-case (`"w"`), named keys lower-case
 * (`"space"`, `"arrowup"`, `"f1"`, `"escape"`). Arrow-key movement always
 * works in addition to the bound movement keys so a rebind can never leave a
 * player unable to walk.
 */

export const KEYBIND_ACTIONS = [
  "moveUp",
  "moveDown",
  "moveLeft",
  "moveRight",
  "attack",
  "pickup",
  "inventory",
  "character",
  "skills",
  "party",
  "guild",
  "friends",
  "worldMap",
  "chat",
  "targetNext",
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
  "settings",
  "debug",
] as const;

export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

export type Keybinds = Record<KeybindAction, string>;

export const DEFAULT_KEYBINDS: Keybinds = {
  moveUp: "w",
  moveDown: "s",
  moveLeft: "a",
  moveRight: "d",
  attack: "space",
  pickup: "z",
  inventory: "i",
  character: "c",
  skills: "k",
  party: "p",
  guild: "g",
  friends: "f",
  worldMap: "m",
  chat: "enter",
  targetNext: "tab",
  hotbar1: "1",
  hotbar2: "2",
  hotbar3: "3",
  hotbar4: "4",
  hotbar5: "f1",
  hotbar6: "f2",
  hotbar7: "f3",
  hotbar8: "f4",
  // F9 is the debug overlay; F3 used to toggle it too but now belongs to
  // hotbar slot 7 (GAME_DESIGN.md §5), so the alias was dropped (D82).
  settings: "o",
  debug: "f9",
};

export const KEYBIND_LABELS: Record<KeybindAction, string> = {
  moveUp: "Move up",
  moveDown: "Move down",
  moveLeft: "Move left",
  moveRight: "Move right",
  attack: "Attack",
  pickup: "Pick up",
  inventory: "Inventory",
  character: "Character",
  skills: "Skills",
  party: "Party",
  guild: "Guild",
  friends: "Friends",
  worldMap: "World map",
  chat: "Chat",
  targetNext: "Next target",
  hotbar1: "Hotbar 1",
  hotbar2: "Hotbar 2",
  hotbar3: "Hotbar 3",
  hotbar4: "Hotbar 4",
  hotbar5: "Hotbar 5",
  hotbar6: "Hotbar 6",
  hotbar7: "Hotbar 7",
  hotbar8: "Hotbar 8",
  settings: "Settings",
  debug: "Debug overlay",
};

const NAMED_KEYS: Record<string, string> = {
  " ": "space",
  spacebar: "space",
  esc: "escape",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  return: "enter",
};

/** Normalizes `KeyboardEvent.key` into the stored binding format. */
export function normalizeKey(key: string): string {
  if (key === " " || key === "Spacebar") {
    return "space";
  }
  const named = NAMED_KEYS[key.toLowerCase()];
  if (named) {
    return named;
  }
  return key.toLowerCase();
}

/** Human-readable label for a binding. */
export function displayKey(binding: string): string {
  switch (binding) {
    case "space":
      return "Space";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    case "escape":
      return "Esc";
    case "enter":
      return "Enter";
    case "tab":
      return "Tab";
    default:
      return binding.toUpperCase();
  }
}

/** Returns the action already bound to `key`, ignoring `except`. */
export function findKeyConflict(
  keybinds: Keybinds,
  key: string,
  except: KeybindAction | null = null,
): KeybindAction | null {
  const normalized = normalizeKey(key);
  for (const action of KEYBIND_ACTIONS) {
    if (action !== except && keybinds[action] === normalized) {
      return action;
    }
  }
  return null;
}

/** True when the event's key is bound to `action`. */
export function matchesKeybind(
  keybinds: Keybinds,
  event: Pick<KeyboardEvent, "key">,
  action: KeybindAction,
): boolean {
  return normalizeKey(event.key) === keybinds[action];
}

/** Parses a stored keybind map, filling unknown/missing entries with defaults. */
export function parseKeybinds(value: unknown): Keybinds {
  const result: Keybinds = { ...DEFAULT_KEYBINDS };
  if (typeof value !== "object" || value === null) {
    return result;
  }
  const record = value as Record<string, unknown>;
  const used = new Set<string>();
  for (const action of KEYBIND_ACTIONS) {
    const candidate = record[action];
    const normalized =
      typeof candidate === "string" && candidate.length > 0
        ? normalizeKey(candidate)
        : DEFAULT_KEYBINDS[action];
    // Hand-edited storage can contain duplicates; first action wins and later
    // ones fall back to their default so one key never fires two actions.
    if (used.has(normalized)) {
      // Prefer this action's default; if that is taken too, reuse the first
      // free default key so the result is always collision-free.
      const fallback =
        !used.has(DEFAULT_KEYBINDS[action])
          ? DEFAULT_KEYBINDS[action]
          : (Object.values(DEFAULT_KEYBINDS).find((key) => !used.has(key)) ?? normalized);
      result[action] = fallback;
      used.add(fallback);
    } else {
      result[action] = normalized;
      used.add(normalized);
    }
  }
  return result;
}

/** True when the DOM target is a text field where game keys must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.("input, textarea, [contenteditable='true']"));
}
