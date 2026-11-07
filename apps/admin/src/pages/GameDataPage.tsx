import { useMemo, useState } from "react";
import { ITEMS, getItem, hasItem } from "@jadethrone/data/items";
import { MONSTERS } from "@jadethrone/data/monsters";
import { DROP_TABLES } from "@jadethrone/data/dropTables";
import { SHOPS } from "@jadethrone/data/shops";
import { SPAWN_GROUPS } from "@jadethrone/data/spawnGroups";
import { NPCS } from "@jadethrone/data/npcs";

type DataTab = "ITEMS" | "MONSTERS" | "DROP_TABLES" | "SHOPS" | "SPAWN_GROUPS" | "NPCS";

const TABS: DataTab[] = ["ITEMS", "MONSTERS", "DROP_TABLES", "SHOPS", "SPAWN_GROUPS", "NPCS"];

interface DataEntry {
  id: string;
  title: string;
  subtitle: string;
  fields: Array<{ label: string; value: string }>;
}

function itemLabel(itemId: string): string {
  return hasItem(itemId) ? `${itemId} (${getItem(itemId).name})` : itemId;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`;
}

function buildEntries(tab: DataTab): DataEntry[] {
  switch (tab) {
    case "ITEMS":
      return ITEMS.map((item) => ({
        id: item.id,
        title: item.name,
        subtitle: `${item.type} / ${item.subtype} · ${item.rarity}`,
        fields: [
          { label: "Level requirement", value: String(item.levelReq) },
          { label: "Classes", value: item.classes === "all" ? "all" : item.classes.join(", ") },
          { label: "Buy / sell", value: `${item.buyPrice}g / ${item.sellPrice}g` },
          {
            label: "Stack",
            value: item.stackable ? `yes (max ${item.maxStack})` : "no",
          },
          {
            label: "Base stats",
            value:
              item.baseStats && Object.keys(item.baseStats).length > 0
                ? Object.entries(item.baseStats)
                    .map(([key, value]) => `${key} +${value}`)
                    .join(", ")
                : "none",
          },
          {
            label: "Upgrade chain",
            value:
              item.upgradeChain && Object.keys(item.upgradeChain).length > 0
                ? Object.entries(item.upgradeChain)
                    .map(([key, chain]) => `${key} +${chain[0]} → +${chain[chain.length - 1]}`)
                    .join(", ")
                : "none",
          },
          ...(item.effect ? [{ label: "Effect", value: JSON.stringify(item.effect) }] : []),
          ...(item.description ? [{ label: "Description", value: item.description }] : []),
        ],
      }));
    case "MONSTERS":
      return MONSTERS.map((monster) => ({
        id: monster.id,
        title: monster.name,
        subtitle: `Lv ${monster.level}${monster.isBoss ? " · boss" : ""} · ${monster.aggroType}`,
        fields: [
          { label: "HP", value: String(monster.hp) },
          { label: "Attack / defense", value: `${monster.attack} / ${monster.defense}` },
          { label: "DEX / speed", value: `${monster.dex} / ${monster.moveSpeed}` },
          { label: "XP", value: String(monster.xp) },
          { label: "Gold", value: `${monster.goldMin}–${monster.goldMax}` },
          { label: "Drop table", value: monster.dropTableId ?? "none" },
          { label: "Aggro range", value: String(monster.aggroRange) },
          { label: "Leash range", value: String(monster.leashRange) },
          { label: "Attack cooldown", value: `${monster.attackCooldownMs}ms` },
          { label: "Size", value: monster.size },
        ],
      }));
    case "DROP_TABLES":
      return DROP_TABLES.map((table) => ({
        id: table.id,
        title: table.id,
        subtitle: `${table.drops.length} drops`,
        fields: table.drops.map((drop) => ({
          label: `${(drop.chance * 100).toFixed(2)}%`,
          value: `${itemLabel(drop.itemId)}${
            drop.minQty === drop.maxQty
              ? drop.minQty > 1
                ? ` ×${drop.minQty}`
                : ""
              : ` ×${drop.minQty}–${drop.maxQty}`
          }`,
        })),
      }));
    case "SHOPS":
      return SHOPS.map((shop) => ({
        id: shop.id,
        title: shop.name,
        subtitle: `${shop.npcId} · ${shop.items.length} items`,
        fields: shop.items.map((entry) => ({ label: "Item", value: itemLabel(entry.itemId) })),
      }));
    case "SPAWN_GROUPS":
      return SPAWN_GROUPS.map((group) => ({
        id: group.id,
        title: group.id,
        subtitle: `${group.members.length} members`,
        fields: [
          { label: "Respawn", value: `${seconds(group.respawnMinMs)} – ${seconds(group.respawnMaxMs)}` },
          ...group.members.map((member) => ({
            label: member.leader ? "Leader" : "Member",
            value: `${member.monsterId} ×${member.count}`,
          })),
        ],
      }));
    case "NPCS":
      return NPCS.map((npc) => ({
        id: npc.id,
        title: npc.name,
        subtitle: npc.kind,
        fields: [
          ...(npc.shopId ? [{ label: "Shop", value: npc.shopId }] : []),
          { label: "Greeting", value: npc.greeting },
        ],
      }));
  }
}

export function GameDataPage() {
  const [tab, setTab] = useState<DataTab>("ITEMS");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const entries = useMemo(() => buildEntries(tab), [tab]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.id.toLowerCase().includes(needle) ||
        entry.title.toLowerCase().includes(needle) ||
        entry.subtitle.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  const detail = entries.find((entry) => entry.id === selected) ?? null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2 border-b border-[var(--jade-soft)] pb-2">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value);
              setSelected(null);
            }}
            className={`rounded px-3 py-1 text-xs ${
              tab === value ? "bg-[var(--jade-soft)] text-white" : "text-[#8d9a94] hover:text-white"
            }`}
          >
            {value.replace("_", " ")}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by id, name or type…"
            className="mb-3 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-3 py-2 text-sm outline-none focus:border-[var(--jade)]"
          />
          <p className="mb-2 text-[10px] tracking-wide uppercase text-[#7d8a84]">
            {filtered.length} of {entries.length}
          </p>
          <div className="grid max-h-[65vh] gap-1 overflow-auto">
            {filtered.map((entry) => (
              <button
                key={`${tab}:${entry.id}`}
                type="button"
                onClick={() => setSelected(entry.id)}
                className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                  selected === entry.id
                    ? "border-[var(--jade)] bg-[#1d2622]"
                    : "border-[#1d2622] hover:border-[var(--jade-soft)]"
                }`}
              >
                <div className="font-semibold text-[#cfd8d3]">{entry.title}</div>
                <div className="mt-1 text-[#7d8a84]">{entry.subtitle}</div>
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="text-xs text-[#7d8a84]">Nothing matches this filter.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--jade-soft)] bg-[var(--lacquer)] p-4">
          {!detail ? (
            <p className="text-sm text-[#8d9a94]">
              Select an entry to see its definition. Game data is read-only in Phase 5.
            </p>
          ) : (
            <div>
              <div className="border-b border-[#1d2622] pb-3">
                <h3 className="text-lg font-semibold text-[var(--gold)]">{detail.title}</h3>
                <p className="text-xs text-[#8d9a94]">{detail.subtitle}</p>
                <p className="mt-1 font-mono text-[10px] text-[#5f6f68]">{detail.id}</p>
              </div>
              <dl className="mt-3 grid gap-2 text-xs">
                {detail.fields.length === 0 ? (
                  <p className="text-[#7d8a84]">No extra fields.</p>
                ) : (
                  detail.fields.map((field, index) => (
                    <div
                      key={`${field.label}:${index}`}
                      className="grid gap-1 border-b border-[#161d1a] pb-1 sm:grid-cols-[180px_1fr]"
                    >
                      <dt className="text-[#7d8a84]">{field.label}</dt>
                      <dd className="break-words text-[#cfd8d3]">{field.value}</dd>
                    </div>
                  ))
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
