const ACCESS_KEY = "jt.admin.access";
const REFRESH_KEY = "jt.admin.refresh";

function storage(): Storage {
  if (typeof sessionStorage !== "undefined") {
    return sessionStorage;
  }
  return localStorage;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export const adminTokens = {
  getAccess(): string | null {
    return storage().getItem(ACCESS_KEY);
  },
  getRefresh(): string | null {
    return storage().getItem(REFRESH_KEY);
  },
  set(tokens: TokenPair): void {
    storage().setItem(ACCESS_KEY, tokens.accessToken);
    storage().setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear(): void {
    storage().removeItem(ACCESS_KEY);
    storage().removeItem(REFRESH_KEY);
  },
  hasSession(): boolean {
    return Boolean(storage().getItem(ACCESS_KEY) ?? storage().getItem(REFRESH_KEY));
  },
};
