import { useEffect, useState } from "react";
import type { AdminAnnouncementRow } from "@jadethrone/shared";
import { adminApi } from "../network/api";

export function AnnouncementsPage() {
  const [rows, setRows] = useState<AdminAnnouncementRow[]>([]);
  const [message, setMessage] = useState("");
  const [interval, setInterval] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await adminApi.announcements();
        if (!cancelled) {
          setRows(result.announcements);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load announcements.",
          );
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const send = async () => {
    setError(null);
    setFeedback(null);
    const intervalMinutes = interval.trim() === "" ? null : Number(interval);
    const expiresInMinutes = expires.trim() === "" ? undefined : Number(expires);
    if (
      (intervalMinutes !== null &&
        (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || !Number.isInteger(intervalMinutes))) ||
      (expiresInMinutes !== undefined &&
        (!Number.isFinite(expiresInMinutes) || expiresInMinutes < 1 || !Number.isInteger(expiresInMinutes)))
    ) {
      setError("Repeat and expiry must be whole minutes of at least 1.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.createAnnouncement({
        message: message.trim(),
        intervalMinutes,
        expiresInMinutes,
      });
      setFeedback("Announcement saved.");
      setMessage("");
      setInterval("");
      setExpires("");
      setRefresh((value) => value + 1);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send announcement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(300px,420px)_1fr]">
      <section className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">New announcement</h3>
        <label className="mb-2 block text-xs">
          Message
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            Repeat every (min)
            <input
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
              placeholder="empty = once"
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            Expires in (min)
            <input
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
              placeholder="optional"
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-sm"
            />
          </label>
        </div>
        {error ? <p className="mt-2 text-xs text-[#ff8f84]">{error}</p> : null}
        {feedback ? <p className="mt-2 text-xs text-[#7ee08a]">{feedback}</p> : null}
        <button
          type="button"
          disabled={busy || message.trim().length === 0}
          onClick={() => void send()}
          className="mt-3 rounded bg-[var(--jade)] px-3 py-1 text-xs font-semibold text-[#0f1210] disabled:opacity-50"
        >
          {interval.trim() === "" ? "Send now" : "Schedule"}
        </button>
      </section>

      <section className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Announcement history</h3>
        <div className="grid max-h-[65vh] gap-2 overflow-auto">
          {rows.map((row) => (
            <div
              key={row.id}
              className="rounded border border-[#1d2622] p-2 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[#cfd8d3]">{row.message}</p>
                <button
                  type="button"
                  onClick={() =>
                    void adminApi
                      .deleteAnnouncement(row.id)
                      .then(() => setRefresh((value) => value + 1))
                      .catch((deleteError: unknown) =>
                        setError(
                          deleteError instanceof Error
                            ? deleteError.message
                            : "Could not delete announcement.",
                        ),
                      )
                  }
                  className="shrink-0 rounded border border-[#7a3b36] px-2 py-0.5 text-[10px] text-[#ff8f84]"
                >
                  delete
                </button>
              </div>
              <div className="mt-1 text-[#7d8a84]">
                {row.kind}
                {row.intervalMs ? ` · every ${Math.round(row.intervalMs / 60000)} min` : ""}
                {row.expiresAt ? ` · expires ${row.expiresAt}` : ""}
                {row.lastSentAt ? ` · last ${row.lastSentAt}` : ""}
              </div>
            </div>
          ))}
          {rows.length === 0 ? <p className="text-xs text-[#7d8a84]">No announcements yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
