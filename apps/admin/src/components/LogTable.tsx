import { Fragment, useState } from "react";
import type { AdminLogRow } from "@jadethrone/shared";

export type LogKind = "item" | "gold" | "admin" | "chat";

interface Column {
  header: string;
  className?: string;
  render: (row: AdminLogRow) => string;
}

function time(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function location(locationName?: string | null, slot?: number | null): string {
  if (!locationName) {
    return "—";
  }
  return slot === null || slot === undefined ? locationName : `${locationName} ${slot}`;
}

function delta(value?: number | null): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

const COLUMNS: Record<LogKind, Column[]> = {
  item: [
    { header: "Time", render: (row) => time(row.createdAt) },
    { header: "Character", render: (row) => row.characterName ?? "—" },
    { header: "Action", render: (row) => row.action },
    { header: "Item", render: (row) => row.definitionId ?? "—" },
    { header: "Qty", render: (row) => (row.quantity ?? "—").toString() },
    {
      header: "From → to",
      render: (row) => `${location(row.fromLocation, row.fromSlot)} → ${location(row.toLocation, row.toSlot)}`,
    },
    { header: "Item UUID", className: "font-mono text-[10px]", render: (row) => row.itemId ?? "—" },
  ],
  gold: [
    { header: "Time", render: (row) => time(row.createdAt) },
    { header: "Character", render: (row) => row.characterName ?? "—" },
    { header: "Reason", render: (row) => row.action },
    { header: "Delta", render: (row) => delta(row.delta) },
    {
      header: "Balance after",
      render: (row) => (row.balanceAfter ?? 0).toLocaleString(),
    },
  ],
  admin: [
    { header: "Time", render: (row) => time(row.createdAt) },
    { header: "Target", render: (row) => row.characterName ?? row.characterId ?? "—" },
    { header: "Action", render: (row) => row.action },
    { header: "IP", render: (row) => row.ip ?? "—" },
  ],
  chat: [
    { header: "Time", render: (row) => time(row.createdAt) },
    { header: "Character", render: (row) => row.characterName ?? "—" },
    { header: "Map", render: (row) => row.action },
    {
      header: "Message",
      render: (row) => {
        const text = row.detail?.text;
        return typeof text === "string" ? text : JSON.stringify(row.detail ?? {});
      },
    },
  ],
};

export function LogTable({ kind, rows }: { kind: LogKind; rows: AdminLogRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const columns = COLUMNS[kind];

  if (rows.length === 0) {
    return <p className="text-xs text-[#7d8a84]">No entries for these filters.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-[#7d8a84]">
          <tr>
            {columns.map((column) => (
              <th key={column.header} className="pb-2 pr-3 whitespace-nowrap">
                {column.header}
              </th>
            ))}
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = expanded === row.id;
            const detail = row.detail && Object.keys(row.detail).length > 0 ? row.detail : null;
            return (
              <Fragment key={row.id}>
                <tr className="border-t border-[#1d2622]">
                  {columns.map((column) => (
                    <td
                      key={column.header}
                      className={`py-2 pr-3 align-top ${column.className ?? ""}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                  <td className="py-2 text-right">
                    {detail ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : row.id)}
                        className="rounded border border-[var(--jade-soft)] px-2 py-0.5 text-[10px] text-[#aab5b0]"
                      >
                        {open ? "hide" : "detail"}
                      </button>
                    ) : null}
                  </td>
                </tr>
                {open && detail ? (
                  <tr className="border-t border-[#161d1a]">
                    <td colSpan={columns.length + 1} className="py-2">
                      <pre className="max-h-48 overflow-auto rounded bg-[#0c100f] p-2 font-mono text-[10px] text-[#8fd3b6]">
                        {JSON.stringify(detail, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
