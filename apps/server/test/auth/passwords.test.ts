import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/auth/passwords";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const passwordHash = await hashPassword("correct-horse-battery");
    expect(passwordHash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(passwordHash, "correct-horse-battery")).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, "wrong-password")).resolves.toBe(false);
  });

  it("uses a random salt so equal passwords hash differently", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);
    expect(first).not.toBe(second);
    await expect(verifyPassword(second, "same-password")).resolves.toBe(true);
  });

  it("fails closed for malformed stored hashes", async () => {
    await expect(verifyPassword("not-a-hash", "anything")).resolves.toBe(false);
    await expect(verifyPassword("", "anything")).resolves.toBe(false);
  });
});
