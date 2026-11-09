import { useEffect, useMemo, useState } from "react";
import type {
  AdminCharacterDetail,
  AdminSearchResponse,
  ItemInstanceDto,
} from "@jadethrone/shared";
import { MAP_LABELS, itemNameColor } from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { getClass } from "@jadethrone/data/classes";
import { adminApi } from "../network/api";
import { AdminItemTooltip } from "../components/AdminItemTooltip";
import { PlayerActions } from "../components/PlayerActions";

type Tab = "stats" | "inventory" | "equipment" | "warehouse";

function itemName(itemId: string): string {
  return hasItem(itemId) ? getItem(itemId).name : itemId;
}

function ItemRows({
  items,
  empty,
  onHover,
  onLeave,
}: {
  items: Array<ItemInstanceDto | null>;
  empty: string;
  onHover: (item: ItemInstanceDto, x: number, y: number) => void;
  onLeave: () => void;
}) {
  const present = items.filter((item): item is ItemInstanceDto => item !== null);
  if (present.length === 0) {
    return <p className="text-xs text-[#7d8a84]">{empty}</p>;
  }
  return (
    <div className="grid max-h-80 gap-1 overflow-auto">
      {present.map((item) => {
        const definition = hasItem(item.itemId) ? getItem(item.itemId) : null;
        return (
          <div
            key={item.id}
            onPointerEnter={(event) => onHover(item, event.clientX, event.clientY)}
            onPointerMove={(event) => onHover(item, event.clientX, event.clientY)}
            onPointerLeave={onLeave}
            className="flex items-center justify-between rounded border border-[#1d2622] px-2 py-1 text-xs"
          >
            <span style={{ color: definition ? itemNameColor(item.bonuses.length) : "#cfd8d3" }}>
              {itemName(item.itemId)}
              {item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : ""}
            </span>
            <span className="text-[#8d9a94]">
              {item.quantity > 1 ? `×${item.quantity} · ` : ""}slot {item.slot}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PlayersPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<AdminSearchResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminCharacterDetail | null>(null);
  const [tab, setTab] = useState<Tab>("stats");
  const [hover, setHover] = useState<{ item: ItemInstanceDto; x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const next = await adminApi.searchPlayers(query);
        if (!cancelled) {
          setSearch(next);
          setError(null);
        }
      } catch (searchError) {
        if (!cancelled) {
          setError(searchError instanceof Error ? searchError.message : "Search failed.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await adminApi.playerDetail(selected);
        if (!cancelled) {
          setDetail(next);
          setError(null);
        }
      } catch (detailError) {
        if (!cancelled) {
          setError(detailError instanceof Error ? detailError.message : "Detail failed.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, refresh]);

  const characters = search?.characters ?? [];
  const accountOnly = (search?.accounts ?? []).filter((account) => account.characters.length === 0);
  const className = useMemo(() => {
    if (!detail) {
      return "";
    }
    try {
      return getClass(detail.character.classId).name;
    } catch {
      return detail.character.classId;
    }
  }, [detail]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
      <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search email, username or character name…"
          className="mb-3 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-3 py-2 text-sm outline-none focus:border-[var(--jade)]"
        />
        {error ? <p className="mb-2 text-xs text-[#ff8f84]">{error}</p> : null}
        {loading && characters.length === 0 ? (
          <p className="text-xs text-[#7d8a84]">Searching…</p>
        ) : null}
        <div className="grid max-h-[65vh] gap-1 overflow-auto">
          {characters.map((character) => (
            <button
              key={character.id}
              type="button"
              onClick={() => {
                setSelected(character.id);
                setDetail(null);
                setTab("stats");
              }}
              className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                selected === character.id
                  ? "border-[var(--jade)] bg-[#1d2622]"
                  : "border-[#1d2622] hover:border-[var(--jade-soft)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#cfd8d3]">
                  Lv {character.level} {character.name}
                </span>
                <span className={character.online ? "text-[#7ee08a]" : "text-[#7d8a84]"}>
                  {character.online ? "online" : "offline"}
                </span>
              </div>
              <div className="mt-1 text-[#7d8a84]">
                {character.accountUsername} · {MAP_LABELS[character.mapId as keyof typeof MAP_LABELS] ?? character.mapId}
                {character.banned ? " · BANNED" : ""}
              </div>
            </button>
          ))}
          {!loading && characters.length === 0 ? (
            <p className="text-xs text-[#7d8a84]">No matching characters.</p>
          ) : null}
        </div>

        {accountOnly.length > 0 ? (
          <div className="mt-3 border-t border-[#1d2622] pt-3">
            <p className="mb-2 text-[10px] tracking-wide uppercase text-[#7d8a84]">
              Accounts without characters
            </p>
            <div className="grid gap-1">
              {accountOnly.map((account) => (
                <div
                  key={account.id}
                  className="rounded border border-[#1d2622] px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#cfd8d3]">{account.username}</span>
                    <span className={account.banned ? "text-[#ff8f84]" : "text-[#7d8a84]"}>
                      {account.banned ? "banned" : account.role}
                    </span>
                  </div>
                  <div className="mt-1 text-[#7d8a84]">{account.email}</div>
                  {account.banned ? (
                    <button
                      type="button"
                      onClick={() =>
                        void adminApi
                          .unban(account.id)
                          .then(() => setRefresh((value) => value + 1))
                          .catch((unbanError: unknown) =>
                            setError(
                              unbanError instanceof Error
                                ? unbanError.message
                                : "Unban failed.",
                            ),
                          )
                      }
                      className="mt-1 rounded bg-[var(--jade)] px-2 py-0.5 text-[10px] font-semibold text-[#0f1210]"
                    >
                      Unban account
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
        {!detail ? (
          <p className="text-sm text-[#8d9a94]">
            {selected ? "Loading character…" : "Select a character to inspect it."}
          </p>
        ) : (
          <div>
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#1d2622] pb-3">
              <div>
                <h3 className="text-lg font-semibold text-[var(--gold)]">
                  Lv {detail.character.level} {detail.character.name}
                </h3>
                <p className="text-xs text-[#8d9a94]">
                  {className} · {detail.account.username} ({detail.account.email})
                </p>
              </div>
              <span className={`text-xs ${detail.online ? "text-[#7ee08a]" : "text-[#7d8a84]"}`}>
                {detail.online ? "online" : "offline"}
              </span>
            </div>
            <div className="mt-3 flex gap-2 border-b border-[#1d2622] pb-2">
              {(["stats", "inventory", "equipment", "warehouse"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`rounded px-3 py-1 text-xs capitalize ${
                    tab === value ? "bg-[var(--jade-soft)] text-white" : "text-[#8d9a94]"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>

            <div className="mt-3 text-xs">
              {tab === "stats" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>Gold: {detail.character.gold.toLocaleString()}</div>
                  <div>Map: {detail.character.mapId}</div>
                  <div>HP: {detail.character.hp} / {detail.character.maxHp}</div>
                  <div>MP: {detail.character.mp} / {detail.character.maxMp}</div>
                  <div>XP: {detail.character.xp}</div>
                  <div>Stat points: {detail.character.statPoints}</div>
                  <div>VIT: {detail.character.stats.vit}</div>
                  <div>INT: {detail.character.stats.int}</div>
                  <div>STR: {detail.character.stats.str}</div>
                  <div>DEX: {detail.character.stats.dex}</div>
                  <div>Ban: {detail.account.bannedUntil ?? "none"}</div>
                  <div>Role: {detail.account.role}</div>
                </div>
              ) : tab === "inventory" ? (
                <ItemRows
                  items={detail.inventory}
                  empty="Empty inventory."
                  onHover={(item, x, y) => setHover({ item, x, y })}
                  onLeave={() => setHover(null)}
                />
              ) : tab === "equipment" ? (
                <ItemRows
                  items={detail.equipment}
                  empty="Nothing equipped."
                  onHover={(item, x, y) => setHover({ item, x, y })}
                  onLeave={() => setHover(null)}
                />
              ) : (
                <ItemRows
                  items={detail.warehouse}
                  empty="Warehouse is empty."
                  onHover={(item, x, y) => setHover({ item, x, y })}
                  onLeave={() => setHover(null)}
                />
              )}
            </div>
            <PlayerActions
              key={detail.character.id}
              detail={detail}
              onChanged={() => setRefresh((value) => value + 1)}
            />
          </div>
        )}
      </div>
      {hover ? <AdminItemTooltip item={hover.item} x={hover.x} y={hover.y} /> : null}
    </div>
  );
}
