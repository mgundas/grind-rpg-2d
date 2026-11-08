/** One live player's cross-map delivery handle. */
export interface SocialHandle {
  accountId: string;
  characterId: string;
  sessionId: string;
  name: string;
  kingdom: string;
  mapId: string;
  roomId: string;
  send(type: string, payload: unknown): void;
  guildId?: string | null;
  /** Optional until guild integration updates live name plates. */
  setGuild?(guildId: string | null, name: string | null): void;
  setGuildTag?(name: string | null): void;
}

/**
 * Process-wide online directory for whispers, friends and guild chat. DB rows
 * remain the authority; this layer only routes messages to live sessions.
 */
export interface SocialDirectory {
  register(handle: SocialHandle): void;
  unregister(characterId: string, sessionId?: string): void;
  get(characterId: string): SocialHandle | undefined;
  findByName(name: string): SocialHandle | undefined;
  isOnline(characterId: string): boolean;
  send(characterId: string, type: string, payload: unknown): boolean;
  sendMany(characterIds: Iterable<string>, type: string, payload: unknown): number;
  list(): SocialHandle[];
  updateGuild(characterId: string, guildId: string | null, name: string | null): void;
  updateGuildTag(characterId: string, name: string | null): void;
  clear(): void;
}

export function createSocialDirectory(): SocialDirectory {
  const byCharacter = new Map<string, SocialHandle>();
  const byName = new Map<string, string>();

  function unregister(characterId: string, sessionId?: string): void {
    const current = byCharacter.get(characterId);
    if (!current) {
      return;
    }
    if (sessionId !== undefined && current.sessionId !== sessionId) {
      // A duplicate join replaced this handle; the old session must not remove it.
      return;
    }
    byCharacter.delete(characterId);
    const key = current.name.toLowerCase();
    if (byName.get(key) === characterId) {
      byName.delete(key);
    }
  }

  function register(handle: SocialHandle): void {
    const previous = byCharacter.get(handle.characterId);
    if (previous) {
      const previousKey = previous.name.toLowerCase();
      if (byName.get(previousKey) === handle.characterId) {
        byName.delete(previousKey);
      }
    }
    byCharacter.set(handle.characterId, handle);
    byName.set(handle.name.toLowerCase(), handle.characterId);
  }

  function send(characterId: string, type: string, payload: unknown): boolean {
    const handle = byCharacter.get(characterId);
    if (!handle) {
      return false;
    }
    try {
      handle.send(type, payload);
      return true;
    } catch {
      return false;
    }
  }

  return {
    register,
    unregister,
    get: (characterId) => byCharacter.get(characterId),
    findByName: (name) => {
      const id = byName.get(name.trim().toLowerCase());
      return id ? byCharacter.get(id) : undefined;
    },
    isOnline: (characterId) => byCharacter.has(characterId),
    send,
    sendMany(characterIds, type, payload) {
      let delivered = 0;
      const seen = new Set<string>();
      for (const characterId of characterIds) {
        if (seen.has(characterId)) {
          continue;
        }
        seen.add(characterId);
        if (send(characterId, type, payload)) {
          delivered += 1;
        }
      }
      return delivered;
    },
    list: () => [...byCharacter.values()],
    updateGuild(characterId, guildId, name) {
      const handle = byCharacter.get(characterId);
      if (!handle) {
        return;
      }
      handle.guildId = guildId;
      if (handle.setGuild) {
        handle.setGuild(guildId, name);
      } else {
        handle.setGuildTag?.(name);
      }
    },
    updateGuildTag(characterId, name) {
      const handle = byCharacter.get(characterId);
      if (!handle) {
        return;
      }
      if (handle.setGuild) {
        handle.setGuild(handle.guildId ?? null, name);
      } else {
        handle.setGuildTag?.(name);
      }
    },
    clear() {
      byCharacter.clear();
      byName.clear();
    },
  };
}
