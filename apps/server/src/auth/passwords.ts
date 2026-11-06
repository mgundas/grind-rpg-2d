import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing policy (GAME_DESIGN.md §10.2). `@node-rs/argon2` defaults to
 * Argon2id v19; we spell out the cost parameters so a future default change in
 * the library cannot silently weaken stored hashes.
 *
 * Length limits are enforced by the request DTOs; this module only hashes and
 * verifies.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const HASH_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

/** Constant-time verification via the native verifier; malformed hashes fail closed. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
