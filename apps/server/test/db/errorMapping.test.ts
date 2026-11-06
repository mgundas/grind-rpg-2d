import { describe, expect, it } from "vitest";
import { ACCOUNT_UNIQUE, CHARACTER_UNIQUE, toServiceError } from "../../src/db/errors";
import { ServiceError } from "../../src/errors";

/** Drizzle wraps pg errors; fabricated wrapper proves the cause-chain walk. */
function wrapped(cause: unknown): Error {
  return Object.assign(new Error("query failed"), { cause });
}

describe("toServiceError", () => {
  it("passes domain errors through unchanged", () => {
    const original = new ServiceError("slots_full", "full");
    expect(toServiceError(original)).toBe(original);
  });

  it("maps known unique constraints to 409 domain codes", () => {
    const email = toServiceError(
      wrapped({ code: "23505", constraint: "accounts_email_lower_uq" }),
      ACCOUNT_UNIQUE,
    );
    expect(email.code).toBe("email_taken");
    expect(email.status).toBe(409);

    const name = toServiceError(
      wrapped({ code: "23505", constraint: "characters_name_lower_uq" }),
      CHARACTER_UNIQUE,
    );
    expect(name.code).toBe("name_taken");
    expect(name.status).toBe(409);
  });

  it("treats unmapped unique violations and unknown errors as internal", () => {
    expect(
      toServiceError(wrapped({ code: "23505", constraint: "sessions_token_hash_uq" })).code,
    ).toBe("internal");
    expect(toServiceError(new Error("boom")).code).toBe("internal");
  });

  it("maps connection failures to 503", () => {
    expect(toServiceError(wrapped({ code: "ECONNREFUSED" })).code).toBe("database_unavailable");
    expect(toServiceError({ code: "08006", message: "connection failure" }).code).toBe(
      "database_unavailable",
    );
    expect(toServiceError(new Error("timeout exceeded when trying to connect")).status).toBe(503);
  });
});
