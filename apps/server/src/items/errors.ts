import type { ItemActionErrorCode } from "@jadethrone/shared";

/** Domain failure from the item layer; never thrown into the room tick. */
export class ItemError extends Error {
  readonly code: ItemActionErrorCode;
  readonly detail?: Record<string, unknown>;

  constructor(code: ItemActionErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ItemError";
    this.code = code;
    this.detail = detail;
  }
}

export function isItemError(error: unknown): error is ItemError {
  return error instanceof ItemError;
}
