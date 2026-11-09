import { useEffect, useState } from "react";
import type { AdminDashboardResponse, AdminMonitorStatus } from "@jadethrone/shared";
import { MAP_LABELS } from "@jadethrone/shared";
import { adminApi } from "../network/api";

export function LiveRoomsPage() {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [status, setStatus] = useState<AdminMonitorStatus | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [dashboard, monitor] = await Promise.all([
          adminApi.dashboard(),
          adminApi.monitorStatus(),
        ]);
        if (!cancelled) {
          setData(dashboard);
          setStatus(monitor);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Rooms failed.");
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshKey]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--gold)]">Colyseus monitor</h3>
          <p className="mt-1 text-xs text-[#8d9a94]">
            {status?.ok
              ? "Authenticated as an admin."
              : "The monitor cookie is missing or expired; log out and back in."}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            className="rounded border border-[var(--jade-soft)] px-3 py-1 text-xs hover:border-[var(--jade)]"
          >
            Refresh
          </button>
          <a
            href="/colyseus/"
            target="_blank"
            rel="noreferrer"
            className="rounded bg-[var(--jade)] px-3 py-1 text-xs font-semibold text-[#0f1210]"
          >
            Open separately
          </a>
        </div>
      </div>

      {error ? <div className="text-xs text-[#ff8f84]">{error}</div> : null}

      <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Rooms</h3>
        <table className="w-full text-left text-xs">
          <thead className="text-[#7d8a84]">
            <tr>
              <th className="pb-2">Map</th>
              <th className="pb-2">Room</th>
              <th className="pb-2 text-right">Players</th>
              <th className="pb-2 text-right">Capacity</th>
              <th className="pb-2 text-right">Started</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rooms ?? []).map((room) => (
              <tr key={room.roomId} className="border-t border-[#1d2622]">
                <td className="py-2">
                  {(MAP_LABELS as Record<string, string>)[room.mapId] ?? room.mapId}
                  <span className="ml-1 text-[10px] text-[#7d8a84]">
                    CH{(room as { channel?: number }).channel ?? 1}
                  </span>
                </td>
                <td className="py-2 font-mono text-[10px]">{room.roomId.slice(0, 8)}</td>
                <td className="py-2 text-right">{room.players}</td>
                <td className="py-2 text-right">{room.maxClients}</td>
                <td className="py-2 text-right">
                  {new Date(room.startedAtMs).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data || data.rooms.length === 0 ? (
          <p className="mt-3 text-xs text-[#7d8a84]">No rooms are running yet.</p>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Room overview</h3>
        <table className="w-full text-left text-xs">
          <thead className="text-[#7d8a84]">
            <tr>
              <th className="pb-2">Map</th>
              <th className="pb-2">Channel</th>
              <th className="pb-2 text-right">Players</th>
            </tr>
          </thead>
          <tbody>
            {(data?.online.byMap ?? []).map((row) => (
              <tr key={`${row.mapId}:${row.channel}`} className="border-t border-[#1d2622]">
                <td className="py-2">
                  {(MAP_LABELS as Record<string, string>)[row.mapId] ?? row.mapId}
                </td>
                <td className="py-2">CH{row.channel}</td>
                <td className="py-2 text-right">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data || data.online.byMap.length === 0 ? (
          <p className="mt-3 text-xs text-[#7d8a84]">No active rooms with players.</p>
        ) : null}
      </div>

      {status?.ok ? (
        <div className="overflow-hidden rounded-lg border border-[var(--jade-soft)] bg-white">
          <iframe
            key={refreshKey}
            title="Colyseus monitor"
            src="/colyseus/"
            className="h-[70vh] w-full"
          />
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4 text-xs text-[#8d9a94]">
          The Colyseus monitor is hidden because the admin cookie is missing or expired. Log out
          and back in, then use “Open separately”.
        </div>
      )}
    </div>
  );
}
