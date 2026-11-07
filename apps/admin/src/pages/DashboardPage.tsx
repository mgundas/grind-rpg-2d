import { useEffect, useState } from "react";
import type { AdminDashboardResponse } from "@jadethrone/shared";
import { MAP_LABELS } from "@jadethrone/shared";
import { adminApi } from "../network/api";
import { OnlineChart, StatCard } from "../components/Dashboard";

function mapLabel(mapId: string): string {
  return (MAP_LABELS as Record<string, string>)[mapId] ?? mapId;
}

export function DashboardPage() {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await adminApi.dashboard();
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Dashboard failed.");
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!data) {
    return <div className="text-sm text-[#8d9a94]">{error ?? "Loading dashboard…"}</div>;
  }

  const memoryMb = Math.round(data.server.rssBytes / (1024 * 1024));

  return (
    <div className="grid gap-4">
      {error ? <div className="text-xs text-[#ff8f84]">{error}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Online players" value={data.online.total} />
        <StatCard label="Registrations today" value={data.registrationsToday} />
        <StatCard label="Gold in economy" value={data.goldInEconomy.toLocaleString()} />
        <StatCard
          label="Server"
          value={`${Math.floor(data.server.uptimeSeconds / 60)}m`}
          detail={`${memoryMb} MB RSS · ${data.server.cpuPercent}% CPU`}
        />
      </div>

      <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Online history</h3>
        <OnlineChart points={data.history} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Players by map</h3>
          {data.online.byMap.length === 0 ? (
            <p className="text-xs text-[#7d8a84]">Nobody online.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-[#7d8a84]">
                <tr>
                  <th className="pb-2">Map</th>
                  <th className="pb-2">Channel</th>
                  <th className="pb-2 text-right">Players</th>
                </tr>
              </thead>
              <tbody>
                {data.online.byMap.map((row) => (
                  <tr key={`${row.mapId}:${row.channel}`} className="border-t border-[#1d2622]">
                    <td className="py-2">{mapLabel(row.mapId)}</td>
                    <td className="py-2">CH{row.channel}</td>
                    <td className="py-2 text-right">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--gold)]">Online now</h3>
          {data.online.players.length === 0 ? (
            <p className="text-xs text-[#7d8a84]">Nobody online.</p>
          ) : (
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-left text-xs">
                <tbody>
                  {data.online.players.map((player) => (
                    <tr key={player.sessionId} className="border-t border-[#1d2622]">
                      <td className="py-2">
                        Lv {player.level} {player.name}
                      </td>
                      <td className="py-2 text-[#8d9a94]">{mapLabel(player.mapId)}</td>
                      <td className="py-2 text-right text-[#8d9a94]">
                        {player.dead ? "dead" : `${player.hp}/${player.maxHp}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
