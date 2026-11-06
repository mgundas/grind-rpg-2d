import { type FormEvent } from "react";
import { GAME_NAME } from "@jadethrone/shared";

/**
 * Visual-only login skeleton. The real auth flow + panel arrives in
 * Phase 5; submit currently does nothing beyond preventDefault.
 */
export function App() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--lacquer-deep)] font-[system-ui,sans-serif] text-[#cfd8d3]">
      <form
        onSubmit={handleSubmit}
        className="w-80 rounded-lg border-2 border-[var(--gold)] bg-[var(--lacquer)] p-8 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
      >
        <h1
          className="text-center text-xl font-semibold tracking-wide"
          style={{ color: "var(--jade)" }}
        >
          {GAME_NAME}
        </h1>
        <p className="mt-1 mb-7 text-center text-xs tracking-widest uppercase text-[#7d8a84]">
          Admin Panel
        </p>

        <label className="mb-1 block text-sm" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="mb-4 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-3 py-2 text-sm outline-none focus:border-[var(--jade)]"
          placeholder="admin@example.com"
        />

        <label className="mb-1 block text-sm" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="mb-6 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-3 py-2 text-sm outline-none focus:border-[var(--jade)]"
          placeholder="••••••••"
        />

        <button
          type="submit"
          className="w-full cursor-pointer rounded bg-[var(--jade)] px-3 py-2 text-sm font-semibold text-[#0f1210] transition-colors hover:bg-[#6fbf9f]"
        >
          Sign in
        </button>

        <p className="mt-5 text-center text-xs text-[#68756f]">
          The panel itself arrives in Phase 5.
        </p>
      </form>
    </div>
  );
}
