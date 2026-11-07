export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
      <div className="text-[11px] tracking-wide uppercase text-[#7d8a84]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--gold)]">{value}</div>
      {detail ? <div className="mt-1 text-xs text-[#8d9a94]">{detail}</div> : null}
    </div>
  );
}

export function OnlineChart({ points }: { points: Array<{ atMs: number; online: number }> }) {
  const width = 640;
  const height = 160;
  const padding = 12;
  if (points.length === 0) {
    return <div className="text-xs text-[#7d8a84]">No samples yet.</div>;
  }
  const max = Math.max(1, ...points.map((point) => point.online));
  const minTime = points[0]!.atMs;
  const maxTime = points[points.length - 1]!.atMs;
  const span = Math.max(1, maxTime - minTime);
  const coords = points
    .map((point) => {
      const x = padding + ((point.atMs - minTime) / span) * (width - padding * 2);
      const y = height - padding - (point.online / max) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-44 w-full rounded border border-[var(--jade-soft)] bg-[#0d1210]"
      role="img"
      aria-label="Online players over time"
    >
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#37544a" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#37544a" />
      {points.length > 1 ? (
        <polyline points={coords} fill="none" stroke="#5da88f" strokeWidth="2" />
      ) : (
        <circle
          cx={width / 2}
          cy={height - padding - (points[0]!.online / max) * (height - padding * 2)}
          r="3"
          fill="#5da88f"
        />
      )}
      <text x={padding + 4} y={padding + 12} fill="#7d8a84" fontSize="10">
        {max} online
      </text>
    </svg>
  );
}
