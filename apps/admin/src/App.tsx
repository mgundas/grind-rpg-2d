import { useEffect, useState, type FormEvent } from "react";
import { GAME_NAME } from "@jadethrone/shared";
import { DashboardPage } from "./pages/DashboardPage";
import { LiveRoomsPage } from "./pages/LiveRoomsPage";
import { PlayersPage } from "./pages/PlayersPage";
import { GameDataPage } from "./pages/GameDataPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { ServerPage } from "./pages/ServerPage";
import { currentPageLabel, useAdminStore, type AdminPage } from "./store";

const NAV: AdminPage[] = ["dashboard", "live", "players", "data", "announcements", "logs", "server"];

function LoginPage() {
  const signIn = useAdminStore((state) => state.signIn);
  const busy = useAdminStore((state) => state.busy);
  const error = useAdminStore((state) => state.error);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void signIn(login.trim(), password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--lacquer-deep)] p-4 font-[system-ui,sans-serif] text-[#cfd8d3]">
      <form
        onSubmit={submit}
        className="w-80 rounded-lg border-2 border-[var(--gold)] bg-[var(--lacquer)] p-8 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
      >
        <h1 className="text-center text-xl font-semibold tracking-wide" style={{ color: "var(--jade)" }}>
          {GAME_NAME}
        </h1>
        <p className="mt-1 mb-7 text-center text-xs tracking-widest uppercase text-[#7d8a84]">
          Admin Panel
        </p>

        <label className="mb-1 block text-sm" htmlFor="login">
          Email or username
        </label>
        <input
          id="login"
          type="text"
          autoComplete="username"
          value={login}
          onChange={(event) => setLogin(event.target.value)}
          className="mb-4 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-3 py-2 text-sm outline-none focus:border-[var(--jade)]"
          placeholder="admin@example.com"
          required
        />

        <label className="mb-1 block text-sm" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mb-6 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-3 py-2 text-sm outline-none focus:border-[var(--jade)]"
          placeholder="••••••••"
          required
        />

        {error ? <p className="mb-3 text-xs text-[#ff8f84]">{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="w-full cursor-pointer rounded bg-[var(--jade)] px-3 py-2 text-sm font-semibold text-[#0f1210] transition-colors hover:bg-[#6fbf9f] disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function PlaceholderPage({ page }: { page: AdminPage }) {
  return (
    <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-6">
      <h2 className="text-lg font-semibold text-[var(--gold)]">{currentPageLabel(page)}</h2>
      <p className="mt-2 text-sm text-[#8d9a94]">
        This page is wired in the next Phase 5 task.
      </p>
    </div>
  );
}

function Shell() {
  const account = useAdminStore((state) => state.account);
  const page = useAdminStore((state) => state.page);
  const setPage = useAdminStore((state) => state.setPage);
  const signOut = useAdminStore((state) => state.signOut);

  return (
    <div className="flex min-h-screen bg-[var(--lacquer-deep)] font-[system-ui,sans-serif] text-[#cfd8d3]">
      <aside className="w-56 shrink-0 border-r border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h1 className="text-lg font-semibold text-[var(--jade)]">{GAME_NAME}</h1>
        <p className="mb-6 text-[10px] tracking-widest uppercase text-[#7d8a84]">Admin Panel</p>
        <nav className="grid gap-1">
          {NAV.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPage(item)}
              className={`rounded px-3 py-2 text-left text-sm transition-colors ${
                page === item
                  ? "bg-[var(--jade-soft)] text-white"
                  : "text-[#aab5b0] hover:bg-[#1d2622] hover:text-white"
              }`}
            >
              {currentPageLabel(item)}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--jade-soft)] bg-[var(--lacquer)] px-6 py-3">
          <h2 className="text-sm font-semibold text-[var(--gold)]">{currentPageLabel(page)}</h2>
          <div className="flex items-center gap-3 text-xs text-[#8d9a94]">
            <span>
              {account?.username} · {account?.role}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded border border-[var(--jade-soft)] px-3 py-1 text-[#cfd8d3] hover:border-[var(--jade)]"
            >
              Log out
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          {page === "dashboard" ? (
            <DashboardPage />
          ) : page === "live" ? (
            <LiveRoomsPage />
          ) : page === "players" ? (
            <PlayersPage />
          ) : page === "data" ? (
            <GameDataPage />
          ) : page === "announcements" ? (
            <AnnouncementsPage />
          ) : page === "server" ? (
            <ServerPage />
          ) : (
            <PlaceholderPage page={page} />
          )}
        </main>
      </div>
    </div>
  );
}

export function App() {
  const phase = useAdminStore((state) => state.phase);
  const boot = useAdminStore((state) => state.boot);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (phase === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--lacquer-deep)] font-[system-ui,sans-serif] text-[#8d9a94]">
        Checking admin session…
      </div>
    );
  }
  return phase === "anonymous" ? <LoginPage /> : <Shell />;
}
