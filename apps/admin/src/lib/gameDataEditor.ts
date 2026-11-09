import type { GameDataDataset } from "@jadethrone/shared";

/** Editable scalar fields for the structured item/monster forms. */
export interface GameDataField {
  key: string;
  label: string;
  kind: "text" | "number";
}

export const ITEM_FIELDS: GameDataField[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "levelReq", label: "Level requirement", kind: "number" },
  { key: "buyPrice", label: "Buy price", kind: "number" },
  { key: "sellPrice", label: "Sell price", kind: "number" },
  { key: "maxStack", label: "Max stack", kind: "number" },
];

export const MONSTER_FIELDS: GameDataField[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "level", label: "Level", kind: "number" },
  { key: "hp", label: "HP", kind: "number" },
  { key: "attack", label: "Attack", kind: "number" },
  { key: "defense", label: "Defense", kind: "number" },
  { key: "xp", label: "XP", kind: "number" },
  { key: "goldMin", label: "Gold min", kind: "number" },
  { key: "goldMax", label: "Gold max", kind: "number" },
];

export function fieldsForDataset(dataset: GameDataDataset): GameDataField[] {
  if (dataset === "items") {
    return ITEM_FIELDS;
  }
  if (dataset === "monsters") {
    return MONSTER_FIELDS;
  }
  return [];
}

/** Entry identity used by the override table (mirrors packages/data/catalog). */
export function entryIdOf(dataset: GameDataDataset, payload: Record<string, unknown>): string {
  if (dataset === "upgrades") {
    return String(payload.from);
  }
  if (dataset === "bonuses") {
    return String(payload.type);
  }
  return String(payload.id);
}

export interface ParsedPayload {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
}

/** Parse the JSON editor text without accepting arrays or primitives. */
export function parsePayloadJson(text: string): ParsedPayload {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, error: "The payload must be a JSON object." };
    }
    return { ok: true, payload: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON." };
  }
}

export interface FieldValues {
  [key: string]: string;
}

export function fieldValuesFor(
  fields: readonly GameDataField[],
  payload: Record<string, unknown>,
): FieldValues {
  return Object.fromEntries(fields.map((field) => [field.key, String(payload[field.key] ?? "")]));
}

export interface AppliedFields {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
}

/** Apply structured form values to a copy of the payload. */
export function applyFieldValues(
  fields: readonly GameDataField[],
  payload: Record<string, unknown>,
  values: FieldValues,
): AppliedFields {
  const next = { ...payload };
  for (const field of fields) {
    const raw = values[field.key] ?? "";
    if (field.kind === "number") {
      if (raw.trim() === "") {
        return { ok: false, error: `${field.label} is required.` };
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return { ok: false, error: `${field.label} must be a number.` };
      }
      next[field.key] = value;
    } else {
      next[field.key] = raw;
    }
  }
  return { ok: true, payload: next };
}
