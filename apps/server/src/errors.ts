import type { ApiErrorCode } from "@jadethrone/shared";

/** HTTP status for every service error code. Kept in one place for the REST layer. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  validation: 400,
  invalid_credentials: 401,
  unauthorized: 401,
  account_banned: 403,
  email_taken: 409,
  username_taken: 409,
  name_taken: 409,
  slots_full: 409,
  character_online: 409,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  rate_limited: 429,
  database_unavailable: 503,
  internal: 500,
};

/**
 * Domain error carrying a stable API code. Services throw these directly; the
 * HTTP middleware maps `code` to `ERROR_STATUS` and serialises the shared
 * `ApiErrorBody` shape. Never include SQL, hashes or tokens in `message`.
 */
export class ServiceError extends Error {
  readonly code: ApiErrorCode;
  readonly fields?: Record<string, string>;

  constructor(code: ApiErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.fields = fields;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}
