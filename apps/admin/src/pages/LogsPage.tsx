import { useEffect, useState } from "react";
import type { AdminLogRow } from "@jadethrone/shared";
import { adminApi } from "../network/api";
import { LogTable, type LogKind } from "../components/LogTable";

type Tab = LogKind | "trade";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "item", label: "Items" },
  { id: "gold", label: "Gold" },
  { id: "admin", label: "Admin" },
  { id: "chat", label: "Chat" },
  { id: "trade", label: "Trades" },
];

const LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Filters {
  q: string;
  characterId: string;
  itemId: string;
  tradeId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  q: "",
  characterId: "",
  itemId: "",
  tradeId: "",
  from: "",
  to: "",
};

function localToIso(value: string): string | null {
  if (value === "") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function queryString(filters: Filters, offset: number): string {
  const params = new URLSearchParams();
  params.set("limit", String(LIMIT));
  params.set("offset", String(offset));
  if (filters.q.trim() !== "") {
    params.set("q", filters.q.trim());
  }
  if (UUID.test(filters.characterId.trim())) {
    params.set("characterId", filters.characterId.trim());
  }
  if (UUID.test(filters.itemId.trim())) {
    params.set("itemId", filters.itemId.trim());
  }
  if (UUID.test(filters.tradeId.trim())) {
    params.set("tradeId", filters.tradeId.trim());
  }
  const from = localToIso(filters.from);
  if (from) {
    params.set("from", from);
  }
  const to = localToIso(filters.to);
  if (to) {
    params.set("to", to);
  }
  return `?${params.toString()}`;
}

export function LogsPage() {
  const [tab, setTab] = useState<Tab>("item");
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AdminLogRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await adminApi.logs(tab, queryString(applied, offset));
        if (!cancelled) {
          setRows(result.entries);
          setLoaded(true);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load logs.");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tab, applied, offset]);

  const apply = () => {
    setOffset(0);
    setApplied({ ...draft });
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setOffset(0);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2 border-b border-[var(--jade-soft)] pb-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setOffset(0);
            }}
            className={`rounded px-3 py-1 text-xs ${
              tab === item.id
                ? "bg-[var(--jade-soft)] text-white"
                : "text-[#8d9a94] hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
            className="grid gap-2 rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4 sm:grid-cols-2 xl:grid-cols-6"
          >
            <label className="text-xs">
              Search
              <input
                value={draft.q}
                onChange={(event) => setDraft({ ...draft, q: event.target.value })}
                placeholder="action, reason, name…"
                className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              Character ID
              <input
                value={draft.characterId}
                onChange={(event) => setDraft({ ...draft, characterId: event.target.value })}
                placeholder="uuid"
                className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 font-mono text-[11px]"
              />
            </label>
            <label className="text-xs">
              Item UUID
              <input
                value={draft.itemId}
                onChange={(event) => setDraft({ ...draft, itemId: event.target.value })}
                placeholder="uuid"
                disabled={tab !== "item"}
                className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 font-mono text-[11px] disabled:opacity-40"
              />
            </label>
            <label className="text-xs">
              From
              <input
                type="datetime-local"
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              To
              <input
                type="datetime-local"
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs">
              Trade ID
              <input
                value={draft.tradeId}
                onChange={(event) => setDraft({ ...draft, tradeId: event.target.value })}
                placeholder="uuid"
                disabled={tab !== "trade"}
                className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 font-mono text-[11px] disabled:opacity-40"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="rounded bg-[var(--jade)] px-3 py-1 text-xs font-semibold text-[#0f1210]"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded border border-[var(--jade-soft)] px-3 py-1 text-xs"
              >
                Reset
              </button>
            </div>
          </form>

          {draft.characterId.trim() !== "" && !UUID.test(draft.characterId.trim()) ? (
            <p className="text-xs text-[#d9b45a]">
              Character ID filters are ignored unless they are a full UUID.
            </p>
          ) : null}
          {error ? <p className="text-xs text-[#ff8f84]">{error}</p> : null}

          <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
            {!loaded ? (
              <p className="text-xs text-[#7d8a84]">Loading logs…</p>
            ) : (
              <LogTable kind={tab} rows={rows} />
            )}
            <div className="mt-4 flex items-center justify-between border-t border-[#1d2622] pt-3 text-xs">
              <span className="text-[#7d8a84]">
                Showing {rows.length === 0 ? 0 : offset + 1}–{offset + rows.length}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  className="rounded border border-[var(--jade-soft)] px-3 py-1 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={rows.length < LIMIT}
                  onClick={() => setOffset(offset + LIMIT)}
                  className="rounded border border-[var(--jade-soft)] px-3 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}
