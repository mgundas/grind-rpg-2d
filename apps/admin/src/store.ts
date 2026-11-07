import { create } from "zustand";
import type { AccountPublic } from "@jadethrone/shared";
import { AdminApiError, adminApi } from "./network/api";
import { adminTokens } from "./network/tokens";

export type AdminPage =
  | "dashboard"
  | "live"
  | "players"
  | "data"
  | "announcements"
  | "logs"
  | "server";

export type AdminPhase = "checking" | "anonymous" | "authenticated";

interface AdminState {
  phase: AdminPhase;
  account: AccountPublic | null;
  page: AdminPage;
  error: string | null;
  busy: boolean;
  setPage: (page: AdminPage) => void;
  setError: (error: string | null) => void;
  boot: () => Promise<void>;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 403) {
      return "This account does not have admin access.";
    }
    return error.message;
  }
  return "Could not reach the server.";
}

export const useAdminStore = create<AdminState>((set) => ({
  phase: "checking",
  account: null,
  page: "dashboard",
  error: null,
  busy: false,
  setPage: (page) => set({ page }),
  setError: (error) => set({ error }),

  async boot() {
    if (!adminApi.hasSession()) {
      set({ phase: "anonymous", account: null });
      return;
    }
    try {
      const me = await adminApi.me();
      if (me.account.role !== "admin" && me.account.role !== "gm") {
        await adminApi.logout();
        set({
          phase: "anonymous",
          account: null,
          error: "This account does not have admin access.",
        });
        return;
      }
      set({ phase: "authenticated", account: me.account, error: null });
    } catch {
      adminTokens.clear();
      set({ phase: "anonymous", account: null });
    }
  },

  async signIn(login, password) {
    set({ busy: true, error: null });
    try {
      const result = await adminApi.login(login, password);
      if (result.account.role !== "admin" && result.account.role !== "gm") {
        await adminApi.logout();
        set({
          phase: "anonymous",
          account: null,
          busy: false,
          error: "This account does not have admin access.",
        });
        return;
      }
      set({
        phase: "authenticated",
        account: result.account,
        busy: false,
        page: "dashboard",
      });
    } catch (error) {
      set({ busy: false, error: messageOf(error) });
    }
  },

  async signOut() {
    set({ busy: true });
    try {
      await adminApi.logout();
    } finally {
      set({ phase: "anonymous", account: null, busy: false, error: null });
    }
  },
}));

export function currentPageLabel(page: AdminPage): string {
  switch (page) {
    case "dashboard":
      return "Dashboard";
    case "live":
      return "Live Rooms";
    case "players":
      return "Players";
    case "data":
      return "Game Data";
    case "announcements":
      return "Announcements";
    case "logs":
      return "Logs";
    case "server":
      return "Server";
  }
}
