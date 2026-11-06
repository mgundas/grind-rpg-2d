import type { RandomSource } from "@jadethrone/shared";
import type { AuthDeps } from "./auth/accountService";
import type { JoinAuthenticator } from "./auth/joinAuth";
import type { SessionRegistry } from "./auth/sessionRegistry";
import type { BulkCharacterSave, CharacterSave } from "./characters/characterService";
import type { Db } from "./db/client";

/** Test/ops overrides for combat timings (production uses the spec values). */
export interface CombatTuning {
  respawnHereDelayMs?: number;
  respawnHereHpFraction?: number;
}

/**
 * Server-wide services resolved by Colyseus room instances (which are created
 * by the framework, not by us). `createGameServer()` installs the real
 * implementations; tests install fakes before booting. There is deliberately no
 * guest/bypass mode: the default is always the DB-backed authenticator.
 */
export interface ServerServices {
  db: Db;
  authDeps: AuthDeps;
  joinAuthenticator: JoinAuthenticator;
  sessionRegistry: SessionRegistry;
  saveCharacter: (characterId: string, save: CharacterSave) => Promise<boolean>;
  saveCharacters: (saves: ReadonlyArray<BulkCharacterSave>) => Promise<void>;
  /** Fresh per-room RNG stream: crypto in production, seeded in tests. */
  createRandomSource: () => RandomSource;
  combatTuning: CombatTuning;
}

let current: ServerServices | null = null;

export function setServerServices(services: ServerServices): void {
  current = services;
}

export function getServerServices(): ServerServices {
  if (!current) {
    throw new Error("Server services have not been initialized (createGameServer must run first)");
  }
  return current;
}

/** Test helper: forget the installed services between test files. */
export function resetServerServices(): void {
  current = null;
}
