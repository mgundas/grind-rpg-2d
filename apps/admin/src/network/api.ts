import type {
  AdminAnnouncementRow,
  AdminCharacterDetail,
  AdminDashboardResponse,
  AdminLogRow,
  AdminMonitorStatus,
  AdminSearchResponse,
  AdminGameDataDatasetResponse,
  AdminGameDataMutationResponse,
  AdminGameDataReloadResponse,
  AdminServerStatus,
  AuthResponse,
  GameDataDataset,
  MeResponse,
} from "@jadethrone/shared";
import { adminTokens } from "./tokens";

/** Thin admin REST client; relative URLs go through the Vite proxy / same origin. */
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseError(response: Response): Promise<AdminApiError> {
  const text = await response.text();
  let code = "internal";
  let message = `Request failed (HTTP ${response.status})`;
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    // Keep the generic message for non-JSON failures.
  }
  return new AdminApiError(response.status, code, message);
}

let refreshInFlight: Promise<AuthResponse | null> | null = null;

async function refresh(): Promise<AuthResponse | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    const refreshToken = adminTokens.getRefresh();
    if (!refreshToken) {
      return null;
    }
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      adminTokens.clear();
      return null;
    }
    const payload = (await response.json()) as AuthResponse;
    adminTokens.set(payload.tokens);
    return payload;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (options.auth !== false) {
      const access = adminTokens.getAccess();
      if (access) {
        headers.authorization = `Bearer ${access}`;
      }
    }
    return fetch(path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  };

  let response = await send();
  if (response.status === 401 && options.auth !== false && adminTokens.getRefresh()) {
    const rotated = await refresh();
    if (rotated) {
      response = await send();
    }
  }
  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const adminApi = {
  async login(login: string, password: string): Promise<AuthResponse> {
    const payload = await request<AuthResponse>("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { login, password },
    });
    adminTokens.set(payload.tokens);
    return payload;
  },
  me(): Promise<MeResponse> {
    return request<MeResponse>("/api/auth/me");
  },
  async logout(): Promise<void> {
    const refreshToken = adminTokens.getRefresh();
    try {
      if (refreshToken) {
        await request<void>("/api/auth/logout", {
          method: "POST",
          auth: false,
          body: { refreshToken },
        });
      }
    } finally {
      adminTokens.clear();
    }
  },
  hasSession(): boolean {
    return adminTokens.hasSession();
  },
  dashboard: () => request<AdminDashboardResponse>("/api/admin/dashboard"),
  online: () => request<{ players: AdminDashboardResponse["online"]["players"] }>("/api/admin/online"),
  searchPlayers: (q: string) =>
    request<AdminSearchResponse>(`/api/admin/players?q=${encodeURIComponent(q)}`),
  playerDetail: (characterId: string) =>
    request<AdminCharacterDetail>(`/api/admin/players/${characterId}`),
  serverStatus: () => request<AdminServerStatus>("/api/admin/server"),
  monitorStatus: () => request<AdminMonitorStatus>("/api/admin/monitor/status"),
  logs: (kind: "item" | "gold" | "admin" | "chat" | "trade", query = "") =>
    request<{ entries: AdminLogRow[] }>(`/api/admin/logs/${kind}${query}`),
  gameData: (dataset: GameDataDataset) =>
    request<AdminGameDataDatasetResponse>(`/api/admin/data/${dataset}`),
  saveGameData: (dataset: GameDataDataset, entryId: string, payload: Record<string, unknown>) =>
    request<AdminGameDataMutationResponse>(
      `/api/admin/data/${dataset}/${encodeURIComponent(entryId)}`,
      { method: "PUT", body: { payload } },
    ),
  deleteGameData: (dataset: GameDataDataset, entryId: string) =>
    request<AdminGameDataMutationResponse>(
      `/api/admin/data/${dataset}/${encodeURIComponent(entryId)}`,
      { method: "DELETE" },
    ),
  reloadGameData: () =>
    request<AdminGameDataReloadResponse>("/api/admin/data/reload", { method: "POST" }),
  announcements: () =>
    request<{ announcements: AdminAnnouncementRow[] }>("/api/admin/announcements"),
  updateCharacter: (characterId: string, body: unknown) =>
    request<{ ok: boolean }>(`/api/admin/players/${characterId}`, {
      method: "PATCH",
      body,
    }),
  teleportTown: (characterId: string) =>
    request<{ ok: boolean }>(`/api/admin/players/${characterId}/teleport-town`, {
      method: "POST",
    }),
  kick: (characterId: string) =>
    request<void>(`/api/admin/players/${characterId}/kick`, { method: "POST" }),
  ban: (characterId: string, body: unknown) =>
    request<{ bannedUntil: string; banReason: string | null }>(
      `/api/admin/players/${characterId}/ban`,
      { method: "POST", body },
    ),
  unban: (accountId: string) =>
    request<{ ok: boolean }>(`/api/admin/accounts/${accountId}/unban`, { method: "POST" }),
  giveItem: (characterId: string, body: unknown) =>
    request<{ item: unknown }>(`/api/admin/players/${characterId}/items`, {
      method: "POST",
      body,
    }),
  removeItem: (characterId: string, itemId: string) =>
    request<void>(`/api/admin/players/${characterId}/items/${itemId}`, {
      method: "DELETE",
    }),
  createAnnouncement: (body: unknown) =>
    request<{ id: string }>("/api/admin/announcements", { method: "POST", body }),
  deleteAnnouncement: (id: string) =>
    request<void>(`/api/admin/announcements/${id}`, { method: "DELETE" }),
  setRates: (xpRate: number, dropRate: number) =>
    request<AdminServerStatus>("/api/admin/server/rates", {
      method: "POST",
      body: { xpRate, dropRate },
    }),
  spawn: (body: unknown) =>
    request<{ spawned: number; mapId: string }>("/api/admin/server/spawn", {
      method: "POST",
      body,
    }),
  scheduleShutdown: (delayMinutes: number, message: string) =>
    request<AdminServerStatus>("/api/admin/server/shutdown", {
      method: "POST",
      body: { delayMinutes, message },
    }),
  cancelShutdown: () =>
    request<AdminServerStatus>("/api/admin/server/shutdown/cancel", { method: "POST" }),
};
