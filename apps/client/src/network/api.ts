import type {
  ApiErrorBody,
  ApiErrorCode,
  AuthResponse,
  CharacterSummary,
  CreateCharacterRequest,
  LoginRequest,
  MeResponse,
  RegisterRequest,
} from "@jadethrone/shared";
import { tokens as defaultTokens, type TokenStore } from "./tokens";

/**
 * REST client for `/api`. Relative URLs work through the Vite dev proxy and
 * on the same origin in production.
 *
 * A 401 on an authenticated endpoint triggers one refresh-token rotation and a
 * single retry; concurrent 401s share the same refresh promise so two tabs of
 * the same page cannot rotate the token twice.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Defaults to the same origin (Vite proxies /api in dev). */
  baseUrl?: string;
  fetchFn?: FetchLike;
  tokens?: TokenStore;
}

export interface ApiClient {
  register(input: RegisterRequest): Promise<AuthResponse>;
  login(input: LoginRequest): Promise<AuthResponse>;
  /** Restore a session at boot; rejects when the refresh token is gone/invalid. */
  restore(): Promise<MeResponse>;
  logout(): Promise<void>;
  me(): Promise<MeResponse>;
  listCharacters(): Promise<CharacterSummary[]>;
  createCharacter(input: CreateCharacterRequest): Promise<CharacterSummary>;
  deleteCharacter(id: string): Promise<void>;
  hasSession(): boolean;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Rotate + retry once on 401 (never for login/register/refresh). */
  retryOn401?: boolean;
}

function toApiError(status: number, payload: unknown): ApiError {
  const body = payload as ApiErrorBody | null;
  const error = body?.error;
  return new ApiError(
    error?.code ?? "internal",
    error?.message ?? `Request failed (HTTP ${status})`,
    status,
    error?.fields,
  );
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  const fetchFn: FetchLike = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  const tokenStore = options.tokens ?? defaultTokens;
  let refreshInFlight: Promise<AuthResponse | null> | null = null;

  function storeAuth(response: AuthResponse): AuthResponse {
    tokenStore.set(response.tokens);
    return response;
  }

  async function rawRequest(path: string, init: RequestOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (init.auth !== false) {
      const access = tokenStore.getAccess();
      if (access) {
        headers.authorization = `Bearer ${access}`;
      }
    }

    const response = await fetchFn(`${baseUrl}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (response.status === 204) {
      return undefined;
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      throw toApiError(response.status, payload);
    }
    return payload;
  }

  async function rotate(): Promise<AuthResponse | null> {
    const refreshToken = tokenStore.getRefresh();
    if (!refreshToken) {
      return null;
    }
    try {
      const payload = (await rawRequest("/api/auth/refresh", {
        body: { refreshToken },
        auth: false,
      })) as AuthResponse;
      return storeAuth(payload);
    } catch (error) {
      // Only clear credentials for a terminal auth failure, and only if this
      // is still the stored refresh token (another tab may have rotated it).
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403) &&
        tokenStore.getRefresh() === refreshToken
      ) {
        tokenStore.clear();
      }
      return null;
    }
  }

  async function refreshTokens(): Promise<AuthResponse | null> {
    refreshInFlight ??= rotate().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    try {
      return (await rawRequest(path, init)) as T;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !init.retryOn401) {
        throw error;
      }
      const refreshed = await refreshTokens();
      if (!refreshed) {
        throw error;
      }
      return (await rawRequest(path, init)) as T;
    }
  }

  function authenticated(response: AuthResponse): AuthResponse {
    storeAuth(response);
    return response;
  }

  return {
    async register(input) {
      const response = await request<AuthResponse>("/api/auth/register", {
        body: input,
        auth: false,
      });
      return authenticated(response);
    },

    async login(input) {
      const response = await request<AuthResponse>("/api/auth/login", {
        body: input,
        auth: false,
      });
      return authenticated(response);
    },

    async restore() {
      const refreshed = await refreshTokens();
      if (!refreshed) {
        tokenStore.clear();
        throw new ApiError("unauthorized", "Session expired. Sign in again.", 401);
      }
      return { account: refreshed.account, characters: refreshed.characters };
    },

    async logout() {
      const refreshToken = tokenStore.getRefresh();
      try {
        if (refreshToken) {
          await rawRequest("/api/auth/logout", { body: { refreshToken }, auth: false });
        }
      } finally {
        tokenStore.clear();
      }
    },

    me() {
      return request<MeResponse>("/api/auth/me", { retryOn401: true });
    },

    async listCharacters() {
      const payload = await request<{ characters: CharacterSummary[] }>("/api/characters", {
        retryOn401: true,
      });
      return payload.characters;
    },

    async createCharacter(input) {
      const payload = await request<{ character: CharacterSummary }>("/api/characters", {
        body: input,
        retryOn401: true,
      });
      return payload.character;
    },

    async deleteCharacter(id) {
      await request<void>(`/api/characters/${encodeURIComponent(id)}`, {
        method: "DELETE",
        retryOn401: true,
      });
    },

    hasSession() {
      return tokenStore.hasSession();
    },
  };
}

/** Shared client used by the UI. */
export const api = createApiClient();
