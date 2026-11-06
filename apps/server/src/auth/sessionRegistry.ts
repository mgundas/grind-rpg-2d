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
 * Single-process only; horizontal scaling is a Phase-10 concern.
 */
export interface SessionHandle {
  accountId: string;
  characterId: string;
  sessionId: string;
  /** Best-effort authoritative position save before the socket closes. */
  saveForKick: () => Promise<void>;
  send: (type: string, payload: unknown) => void;
  leave: (code: number) => void;
}

export class SessionRegistry {
  private readonly byAccount = new Map<string, SessionHandle>();
  private readonly byCharacter = new Map<string, SessionHandle>();
  private readonly kicking = new Set<string>();

  /** Register a joined session, replacing and kicking any older one. */
  async register(handle: SessionHandle): Promise<void> {
    const previous = this.byAccount.get(handle.accountId);
    if (previous && previous.sessionId !== handle.sessionId) {
      await this.kickHandle(previous, "duplicate");
    }
    this.byAccount.set(handle.accountId, handle);
    this.byCharacter.set(handle.characterId, handle);
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

  /** Login calls this after the token version bump commits. */
  async kickAccount(accountId: string, reason: SessionKickReason): Promise<void> {
    const handle = this.byAccount.get(accountId);
    if (handle) {
      await this.kickHandle(handle, reason);
    }
  }

  async kickCharacter(characterId: string, reason: SessionKickReason): Promise<void> {
    const handle = this.byCharacter.get(characterId);
    if (handle) {
      await this.kickHandle(handle, reason);
    }
  }

  clear(): void {
    this.byAccount.clear();
    this.byCharacter.clear();
    this.kicking.clear();
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

    const payload: SessionKickedPayload = { reason };
    try {
      handle.send(MSG.sessionKicked, payload);
    } catch {
      // Socket already gone; the close below is still the fallback.
    }
    try {
      handle.leave(SESSION_KICK_CODE);
    } catch (error) {
      logger.warn(
        { accountId: handle.accountId, sessionId: handle.sessionId, error },
        "failed to close kicked session",
      );
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
