import {
  MSG,
  SESSION_KICK_CODE,
  type SessionKickReason,
  type SessionKickedPayload,
} from "@jadethrone/shared";
import { logger } from "../logger";

/**
 * In-process map of the one live session per account/character.
 *
 * A new login (or a duplicate join with the same token) replaces the previous
 * session: the previous session is saved first, then receives a
 * `sessionKicked` message and is closed with the application close code 4100.
 *
 * Registrations are serialized per account and carry the account's
 * `token_version`. A reservation created before a login/logout bump is stale;
 * it is rejected instead of kicking the newer, legitimate session.
 */
export interface SessionHandle {
  accountId: string;
  characterId: string;
  sessionId: string;
  tokenVersion: number;
  /** Best-effort authoritative position save before the socket closes. */
  saveForKick: () => Promise<void>;
  send: (type: string, payload: unknown) => void;
  leave: (code: number) => void;
}

export class SessionRegistry {
  private readonly byAccount = new Map<string, SessionHandle>();
  private readonly byCharacter = new Map<string, SessionHandle>();
  private readonly kicking = new Set<string>();
  private readonly latestVersion = new Map<string, number>();
  /** Per-account serialization of register/kick decisions. */
  private readonly queues = new Map<string, Promise<unknown>>();

  /** Login/logout call this after committing the new token version. */
  noteAccount(accountId: string, tokenVersion: number): void {
    const current = this.latestVersion.get(accountId) ?? 0;
    if (tokenVersion > current) {
      this.latestVersion.set(accountId, tokenVersion);
    }
  }

  /**
   * Register a joined session. Returns false when the reservation is stale
   * (its token version is below the account's current generation); the caller
   * must discard the player and close the socket.
   */
  register(handle: SessionHandle): Promise<boolean> {
    const previous = this.queues.get(handle.accountId) ?? Promise.resolve();
    const run = previous.then(
      () => this.registerNow(handle),
      () => this.registerNow(handle),
    );
    this.queues.set(
      handle.accountId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async registerNow(handle: SessionHandle): Promise<boolean> {
    const latest = this.latestVersion.get(handle.accountId);
    if (latest !== undefined && handle.tokenVersion < latest) {
      await this.closeStale(handle);
      return false;
    }
    this.noteAccount(handle.accountId, handle.tokenVersion);

    const previous = this.byAccount.get(handle.accountId);
    if (previous && previous.sessionId !== handle.sessionId) {
      await this.kickHandle(previous, "duplicate");
    }

    // A login/logout may have bumped the generation while we awaited the kick.
    const current = this.latestVersion.get(handle.accountId);
    if (current !== undefined && handle.tokenVersion < current) {
      await this.closeStale(handle);
      return false;
    }

    this.byAccount.set(handle.accountId, handle);
    this.byCharacter.set(handle.characterId, handle);
    return true;
  }

  /** Only remove the entry if it is still the current session (warp safety). */
  unregister(accountId: string, sessionId: string): void {
    const accountEntry = this.byAccount.get(accountId);
    if (accountEntry?.sessionId !== sessionId) {
      return;
    }
    this.byAccount.delete(accountId);
    if (this.byCharacter.get(accountEntry.characterId)?.sessionId === sessionId) {
      this.byCharacter.delete(accountEntry.characterId);
    }
  }

  getActive(accountId: string): SessionHandle | undefined {
    return this.byAccount.get(accountId);
  }

  isCharacterOnline(characterId: string): boolean {
    return this.byCharacter.has(characterId);
  }

  /** Login/logout call this after the token version bump commits. */
  async kickAccount(accountId: string, reason: SessionKickReason): Promise<void> {
    const handle = this.byAccount.get(accountId);
    if (handle) {
      await this.kickHandle(handle, reason);
    }
  }

  async kickCharacter(characterId: string, reason: SessionKickReason): Promise<boolean> {
    const handle = this.byCharacter.get(characterId);
    if (!handle) {
      return false;
    }
    await this.kickHandle(handle, reason);
    return true;
  }

  clear(): void {
    this.byAccount.clear();
    this.byCharacter.clear();
    this.kicking.clear();
    this.latestVersion.clear();
    this.queues.clear();
  }

  private async closeStale(handle: SessionHandle): Promise<void> {
    this.sendKick(handle, "login");
    try {
      handle.leave(SESSION_KICK_CODE);
    } catch {
      // Socket already gone.
    }
  }

  private async kickHandle(handle: SessionHandle, reason: SessionKickReason): Promise<void> {
    if (this.kicking.has(handle.sessionId)) {
      return;
    }
    this.kicking.add(handle.sessionId);
    try {
      try {
        await handle.saveForKick();
      } catch (error) {
        logger.error(
          { accountId: handle.accountId, sessionId: handle.sessionId, error },
          "failed to save session before kick",
        );
      }
      this.remove(handle);
    } finally {
      this.kicking.delete(handle.sessionId);
    }

    this.sendKick(handle, reason);
    try {
      handle.leave(SESSION_KICK_CODE);
    } catch (error) {
      logger.warn(
        { accountId: handle.accountId, sessionId: handle.sessionId, error },
        "failed to close kicked session",
      );
    }
  }

  private sendKick(handle: SessionHandle, reason: SessionKickReason): void {
    const payload: SessionKickedPayload = { reason };
    try {
      handle.send(MSG.sessionKicked, payload);
    } catch {
      // Socket already gone; the close below is still the fallback.
    }
  }

  private remove(handle: SessionHandle): void {
    if (this.byAccount.get(handle.accountId)?.sessionId === handle.sessionId) {
      this.byAccount.delete(handle.accountId);
    }
    if (this.byCharacter.get(handle.characterId)?.sessionId === handle.sessionId) {
      this.byCharacter.delete(handle.characterId);
    }
  }
}
