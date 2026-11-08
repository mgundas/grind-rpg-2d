import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminGameDataDatasetResponse,
  GameDataDataset,
} from "@jadethrone/shared";
import { adminApi, AdminApiError } from "../network/api";
import {
  applyFieldValues,
  entryIdOf,
  fieldValuesFor,
  fieldsForDataset,
  parsePayloadJson,
} from "../lib/gameDataEditor";

const DATASETS: Array<{ id: GameDataDataset; label: string }> = [
  { id: "items", label: "Items" },
  { id: "monsters", label: "Monsters" },
  { id: "dropTables", label: "Drop tables" },
  { id: "shops", label: "Shops" },
  { id: "spawnGroups", label: "Spawn groups" },
  { id: "npcs", label: "NPCs" },
  { id: "skills", label: "Skills" },
  { id: "stones", label: "Stones" },
  { id: "upgrades", label: "Upgrades" },
  { id: "bonuses", label: "Bonuses" },
];

function payloadText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function GameDataPage() {
  const [dataset, setDataset] = useState<GameDataDataset>("items");
  const [data, setData] = useState<AdminGameDataDatasetResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: GameDataDataset, keepSelection = false) => {
    try {
      const result = await adminApi.gameData(next);
      setData(result);
      if (!keepSelection) {
        setSelectedId(null);
        setJsonText("");
        setFields({});
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load game data.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const result = await adminApi.gameData(dataset);
        if (!cancelled) {
          setData(result);
          setSelectedId(null);
          setJsonText("");
          setFields({});
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load game data.");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [dataset]);

  const entries = useMemo(() => {
    const rows = data?.merged ?? [];
    const needle = query.trim().toLowerCase();
    return rows
      .map((row) => {
        const record = row as Record<string, unknown>;
        const id = entryIdOf(dataset, record);
        const name = typeof record.name === "string" ? record.name : id;
        const subtitle =
          typeof record.type === "string"
            ? record.type
            : typeof record.kind === "string"
              ? record.kind
              : dataset;
        return { id, name, subtitle, record };
      })
      .filter(
        (entry) =>
          needle === "" ||
          entry.id.toLowerCase().includes(needle) ||
          entry.name.toLowerCase().includes(needle) ||
          entry.subtitle.toLowerCase().includes(needle),
      )
      .sort((one, two) => one.id.localeCompare(two.id));
  }, [data, dataset, query]);

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const overrideIds = useMemo(
    () => new Set((data?.overrides ?? []).map((override) => override.entryId)),
    [data],
  );
  const visibleFields = fieldsForDataset(dataset);

  const select = (id: string) => {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) {
      return;
    }
    setSelectedId(id);
    setJsonText(payloadText(entry.record));
    setFields(fieldValuesFor(visibleFields, entry.record));
    setMessage(null);
    setError(null);
  };

  const updateField = (key: string, value: string) => {
    const parsed = parsePayloadJson(jsonText);
    if (!parsed.ok || !parsed.payload) {
      return;
    }
    const nextFields = { ...fields, [key]: value };
    const applied = applyFieldValues(visibleFields, parsed.payload, nextFields);
    setFields(nextFields);
    if (applied.ok && applied.payload) {
      setJsonText(payloadText(applied.payload));
    }
  };

  const save = async () => {
    if (!selected) {
      return;
    }
    const parsed = parsePayloadJson(jsonText);
    if (!parsed.ok || !parsed.payload) {
      setError(parsed.error ?? "Invalid payload.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await adminApi.saveGameData(dataset, selected.id, parsed.payload);
      setMessage(`Saved ${selected.id} · catalog v${result.version}`);
      await load(dataset, true);
    } catch (saveError) {
      setError(
        saveError instanceof AdminApiError
          ? `${saveError.message} (${saveError.code})`
          : "Could not save that override.",
      );
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.deleteGameData(dataset, selected.id);
      setMessage(`Reverted ${selected.id} · catalog v${result.version}`);
      await load(dataset, true);
    } catch (revertError) {
      setError(
        revertError instanceof Error ? revertError.message : "Could not revert that override.",
      );
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.reloadGameData();
      setMessage(`Catalog reloaded · v${result.version} · ${result.overrides} overrides`);
      await load(dataset, true);
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : "Reload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--jade-soft)] pb-2">
        {DATASETS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setDataset(entry.id)}
            className={`rounded px-3 py-1 text-xs ${
              dataset === entry.id
                ? "bg-[var(--jade-soft)] text-white"
                : "text-[#8d9a94] hover:text-white"
            }`}
          >
            {entry.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[#7d8a84]">
          catalog v{data?.version ?? "—"}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void reload()}
          className="rounded border border-[var(--jade-soft)] px-3 py-1 text-xs disabled:opacity-40"
        >
          Reload catalog
        </button>
      </div>

      {message ? <p className="text-xs text-[#8fd3b6]">{message}</p> : null}
      {error ? <p className="text-xs text-[#ff8f84]">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
        <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by id or name…"
            className="mb-3 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-3 py-2 text-sm outline-none focus:border-[var(--jade)]"
          />
          <p className="mb-2 text-[10px] uppercase tracking-wide text-[#7d8a84]">
            {entries.length} entries · {overrideIds.size} overrides
          </p>
          <div className="grid max-h-[65vh] gap-1 overflow-auto">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => select(entry.id)}
                className={`rounded border px-3 py-2 text-left text-xs ${
                  selectedId === entry.id
                    ? "border-[var(--jade)] bg-[#1d2622]"
                    : "border-[#1d2622] hover:border-[var(--jade-soft)]"
                }`}
              >
                <div className="font-semibold text-[#cfd8d3]">{entry.name}</div>
                <div className="mt-1 font-mono text-[10px] text-[#7d8a84]">
                  {entry.id}
                  {overrideIds.has(entry.id) ? " · override" : ""}
                </div>
              </button>
            ))}
            {!busy && entries.length === 0 ? (
              <p className="text-xs text-[#7d8a84]">Nothing matches this filter.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
          {!selected ? (
            <p className="text-sm text-[#8d9a94]">
              Select an entry to edit its JSON. Item and monster rows also have quick fields.
            </p>
          ) : (
            <div className="grid gap-3">
              <div className="border-b border-[#1d2622] pb-3">
                <h3 className="text-lg font-semibold text-[var(--gold)]">{selected.name}</h3>
                <p className="font-mono text-[10px] text-[#5f6f68]">{selected.id}</p>
              </div>

              {visibleFields.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {visibleFields.map((field) => (
                    <label key={field.key} className="text-xs">
                      {field.label}
                      <input
                        value={fields[field.key] ?? ""}
                        onChange={(event) => updateField(field.key, event.target.value)}
                        className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1 text-sm"
                      />
                    </label>
                  ))}
                </div>
              ) : null}

              <label className="text-xs">
                Payload JSON
                <textarea
                  value={jsonText}
                  onChange={(event) => setJsonText(event.target.value)}
                  spellCheck={false}
                  rows={18}
                  className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] p-2 font-mono text-[11px] text-[#cfd8d3]"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="rounded bg-[var(--jade)] px-3 py-1 text-xs font-semibold text-[#0f1210] disabled:opacity-40"
                >
                  Save override
                </button>
                <button
                  type="button"
                  disabled={busy || !overrideIds.has(selected.id)}
                  onClick={() => void revert()}
                  className="rounded border border-[var(--jade-soft)] px-3 py-1 text-xs disabled:opacity-40"
                >
                  Revert to base
                </button>
              </div>

              <p className="text-[10px] text-[#7d8a84]">
                Saves validate the whole merged dataset. Adding new NPCs, shops or spawn groups
                only affects maps that already reference their ids.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
