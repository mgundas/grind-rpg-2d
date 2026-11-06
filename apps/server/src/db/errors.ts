import type { ApiErrorCode } from "@jadethrone/shared";
import { ServiceError } from "../errors";

/**
 * Translate Drizzle/pg failures into the small domain error taxonomy.
 *
 * Drizzle wraps pg errors (`DrizzleQueryError.cause`), and a failed rollback can
 * replace the original error, so classifiers walk a shallow cause chain instead
 * of relying on one error class. Connection failures become 503; unique
 * violations become their domain 409 via each service's constraint map.
 */
export const ACCOUNT_UNIQUE: Record<string, ApiErrorCode> = {
  accounts_email_lower_uq: "email_taken",
  accounts_username_lower_uq: "username_taken",
};

export const CHARACTER_UNIQUE: Record<string, ApiErrorCode> = {
  characters_name_lower_uq: "name_taken",
};

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNRESET",
  "EPIPE",
  "57P01",
  "57P02",
  "57P03",
  "53300",
  "08001",
  "08006",
  "28P01",
]);

const CONNECTION_MESSAGE =
  /connection (terminated|refused|closed)|timeout exceeded when trying to connect|too many clients|password authentication failed/i;

function causeChain(error: unknown, depth = 5): unknown[] {
  const chain: unknown[] = [error];
  let current = error;
  for (let index = 0; index < depth; index++) {
    if (typeof current !== "object" || current === null || !("cause" in current)) {
      break;
    }
    current = (current as { cause?: unknown }).cause;
    if (current === undefined) {
      break;
    }
    chain.push(current);
  }
  return chain;
}

export function pgErrorInfo(
  error: unknown,
): { code: string; constraint?: string; message: string } | null {
  for (const candidate of causeChain(error)) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const record = candidate as { code?: unknown; constraint?: unknown; message?: unknown };
    if (typeof record.code === "string") {
      return {
        code: record.code,
        constraint: typeof record.constraint === "string" ? record.constraint : undefined,
        message: typeof record.message === "string" ? record.message : "",
      };
    }
  }
  return null;
}

export function isConnectionError(error: unknown): boolean {
  for (const candidate of causeChain(error)) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const record = candidate as { code?: unknown; message?: unknown };
    if (typeof record.code === "string" && CONNECTION_CODES.has(record.code)) {
      return true;
    }
    if (typeof record.message === "string" && CONNECTION_MESSAGE.test(record.message)) {
      return true;
    }
  }
  return false;
}

const UNIQUE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  email_taken: "That email is already registered.",
  username_taken: "That username is already taken.",
  name_taken: "That character name is already taken.",
};

export function toServiceError(
  error: unknown,
  uniqueMap?: Record<string, ApiErrorCode>,
): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }

  const info = pgErrorInfo(error);
  if (info?.code === "23505" && info.constraint) {
    const code = uniqueMap?.[info.constraint];
    if (code) {
      return new ServiceError(code, UNIQUE_MESSAGES[code] ?? "already taken");
    }
  }

  if (isConnectionError(error)) {
    return new ServiceError("database_unavailable", "The database is unavailable. Try again soon.");
  }

  return new ServiceError("internal", "Something went wrong. Try again.");
}
