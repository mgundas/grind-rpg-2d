import { useEffect, useState } from "react";
import type { AdminServerStatus } from "@jadethrone/shared";
import { MONSTERS } from "@jadethrone/data/monsters";
import { adminApi } from "../network/api";

function StatusLine({ status }: { status: AdminServerStatus }) {
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div>Online: {status.online}</div>
      <div>XP rate: {status.xpRate}×</div>
      <div>Drop rate: {status.dropRate}×</div>
      <div>Uptime: {Math.floor(status.uptimeSeconds / 60)} min</div>
      <div className="sm:col-span-2 lg:col-span-4">
        Shutdown:{" "}
        {status.shutdownAtMs
          ? `${new Date(status.shutdownAtMs).toLocaleString()} — ${status.shutdownMessage ?? ""}`
          : "not scheduled"}
      </div>
    </div>
  );
}

function Controls({
  status,
  onChanged,
}: {
  status: AdminServerStatus;
  onChanged: () => void;
}) {
  const [xpRate, setXpRate] = useState(String(status.xpRate));
  const [dropRate, setDropRate] = useState(String(status.dropRate));
  const [typeId, setTypeId] = useState(MONSTERS[0]?.id ?? "wild_dog");
  const [count, setCount] = useState("1");
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [delay, setDelay] = useState("30");
  const [message, setMessage] = useState("Server maintenance");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await action();
      setFeedback(`${label} succeeded.`);
      onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      {feedback ? <p className="text-xs text-[#7ee08a]">{feedback}</p> : null}
      {error ? <p className="text-xs text-[#ff8f84]">{error}</p> : null}

      <section className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Event multipliers</h3>
        <div className="grid gap-2 sm:grid-cols-[120px_120px_auto]">
          <label className="text-xs">
            XP rate
            <input
              value={xpRate}
              onChange={(event) => setXpRate(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            />
          </label>
          <label className="text-xs">
            Drop rate
            <input
              value={dropRate}
              onChange={(event) => setDropRate(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run("Rate update", () =>
                adminApi.setRates(Number(xpRate), Number(dropRate)),
              )
            }
            className="self-end rounded bg-[var(--jade)] px-3 py-1 text-xs font-semibold text-[#0f1210]"
          >
            Apply
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Spawn monster</h3>
        <div className="grid gap-2 sm:grid-cols-[1fr_80px_90px_90px_auto]">
          <select
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
            className="rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-xs"
          >
            {MONSTERS.map((monster) => (
              <option key={monster.id} value={monster.id}>
                {monster.name} (Lv {monster.level})
              </option>
            ))}
          </select>
          <input
            value={count}
            onChange={(event) => setCount(event.target.value)}
            placeholder="count"
            className="rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-xs"
          />
          <input
            value={x}
            onChange={(event) => setX(event.target.value)}
            placeholder="x (optional)"
            className="rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-xs"
          />
          <input
            value={y}
            onChange={(event) => setY(event.target.value)}
            placeholder="y (optional)"
            className="rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run("Spawn", () =>
                adminApi.spawn({
                  typeId,
                  count: Math.max(1, Number(count) || 1),
                  ...(x.trim() === "" ? {} : { x: Number(x) }),
                  ...(y.trim() === "" ? {} : { y: Number(y) }),
                }),
              )
            }
            className="rounded bg-[var(--jade)] px-3 py-1 text-xs font-semibold text-[#0f1210]"
          >
            Spawn
          </button>
        </div>
        <p className="mt-2 text-[10px] text-[#7d8a84]">
          Requires at least one online player; omitted coordinates spawn around them.
        </p>
      </section>

      <section className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Maintenance shutdown</h3>
        <div className="grid gap-2 sm:grid-cols-[110px_1fr_auto_auto]">
          <input
            value={delay}
            onChange={(event) => setDelay(event.target.value)}
            placeholder="minutes"
            className="rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-xs"
          />
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run("Shutdown schedule", () =>
                adminApi.scheduleShutdown(Math.max(1, Number(delay) || 30), message),
              )
            }
            className="rounded border border-[#7a3b36] px-3 py-1 text-xs text-[#ff8f84]"
          >
            Schedule
          </button>
          <button
            type="button"
            disabled={busy || !status.shutdownAtMs}
            onClick={() => void run("Shutdown cancel", () => adminApi.cancelShutdown())}
            className="rounded border border-[var(--jade-soft)] px-3 py-1 text-xs disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

export function ServerPage() {
  const [status, setStatus] = useState<AdminServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await adminApi.serverStatus();
        if (!cancelled) {
          setStatus(next);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load server status.",
          );
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  return (
    <div className="grid gap-4">
      {error ? <div className="text-xs text-[#ff8f84]">{error}</div> : null}
      <section className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Server status</h3>
        {status ? <StatusLine status={status} /> : <p className="text-xs text-[#7d8a84]">Loading…</p>}
      </section>
      {status ? (
        <Controls
          key={`${status.xpRate}:${status.dropRate}:${status.shutdownAtMs ?? 0}:${status.online}`}
          status={status}
          onChanged={() => setRefresh((value) => value + 1)}
        />
      ) : null}
    </div>
  );
}
