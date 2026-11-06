/**
 * Token storage. The default is `localStorage` (one account per browser);
 * tests and the API client use the same interface with an in-memory store.
 * Tokens are never put in cookies, so the REST API is not CSRF-exposed.
 */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStore {
  getAccess(): string | null;
  getRefresh(): string | null;
  set(tokens: TokenPair): void;
  clear(): void;
  hasSession(): boolean;
}

export const ACCESS_TOKEN_KEY = "jt.access";
export const REFRESH_TOKEN_KEY = "jt.refresh";

export function createMemoryStorage(): TokenStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function browserStorage(): TokenStorage {
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return createMemoryStorage();
}

export function createTokenStore(storage: TokenStorage): TokenStore {
  return {
    getAccess: () => storage.getItem(ACCESS_TOKEN_KEY),
    getRefresh: () => storage.getItem(REFRESH_TOKEN_KEY),
    set(tokens) {
      storage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
      storage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    },
    clear() {
      storage.removeItem(ACCESS_TOKEN_KEY);
      storage.removeItem(REFRESH_TOKEN_KEY);
    },
    hasSession() {
      return Boolean(storage.getItem(ACCESS_TOKEN_KEY) ?? storage.getItem(REFRESH_TOKEN_KEY));
    },
  };
}

/** Shared browser store; lazy storage lookup keeps Node imports safe. */
export const tokens = createTokenStore(browserStorage());
