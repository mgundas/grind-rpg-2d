import { MAX_ADMIN_SPAWN, MAX_LEVEL, type AccountRole } from "@jadethrone/shared";

export type GmCommand =
  | { kind: "goto"; x: number; y: number }
  | { kind: "warp"; name: string }
  | { kind: "summon"; name: string }
  | { kind: "spawn"; typeId: string; count: number }
  | { kind: "item"; itemId: string; count: number }
  | { kind: "level"; level: number }
  | { kind: "invisible" }
  | { kind: "kick"; name: string }
  | { kind: "unknown"; raw: string };

export function isGmRole(role: AccountRole): boolean {
  return role === "gm" || role === "admin";
}

/** Parse a leading slash command; non-command chat returns null. */
export function parseGmCommand(text: string): GmCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const [rawName, ...args] = trimmed.slice(1).split(/\s+/);
  const name = (rawName ?? "").toLowerCase();
  switch (name) {
    case "goto": {
      const x = Number(args[0]);
      const y = Number(args[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { kind: "unknown", raw: trimmed };
      }
      return { kind: "goto", x, y };
    }
    case "warp":
    case "summon":
    case "kick": {
      const target = args.join(" ").trim();
      return target ? { kind: name, name: target } : { kind: "unknown", raw: trimmed };
    }
    case "spawn":
    case "item": {
      const id = args[0];
      if (!id) {
        return { kind: "unknown", raw: trimmed };
      }
      const count = args[1] === undefined ? 1 : Number(args[1]);
      if (!Number.isInteger(count) || count < 1 || count > MAX_ADMIN_SPAWN) {
        return { kind: "unknown", raw: trimmed };
      }
      return name === "spawn"
        ? { kind: "spawn", typeId: id, count }
        : { kind: "item", itemId: id, count };
    }
    case "level": {
      const level = Number(args[0]);
      if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
        return { kind: "unknown", raw: trimmed };
      }
      return { kind: "level", level };
    }
    case "invisible":
      return { kind: "invisible" };
    default:
      return { kind: "unknown", raw: trimmed };
  }
}
