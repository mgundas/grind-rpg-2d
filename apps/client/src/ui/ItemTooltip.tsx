import { RARITY_COLORS, type ItemInstanceDto } from "@jadethrone/shared";
import { getItem } from "@jadethrone/data/items";
import { useUiStore } from "./store";
import { theme } from "./theme";

interface ItemTooltipProps {
  item: ItemInstanceDto;
  x: number;
  y: number;
}

function statLine(label: string, value: number | undefined, suffix = ""): string | null {
  if (value === undefined || value === 0) {
    return null;
  }
  return `${label} +${value}${suffix}`;
}

/** Floating item card; positioned near the pointer and clamped to the viewport. */
export function ItemTooltip({ item, x, y }: ItemTooltipProps) {
  const level = useUiStore((state) => state.selfStats?.level ?? 1);
  const characters = useUiStore((state) => state.characters);
  const selectedId = useUiStore((state) => state.selectedCharacterId);
  const classId = characters.find((character) => character.id === selectedId)?.classId;
  let definition;
  try {
    definition = getItem(item.itemId);
  } catch {
    return null;
  }
  const stats = definition.baseStats ?? {};
  const lines = [
    statLine("Attack", stats.attack),
    statLine("Defense", stats.defense),
    statLine("Max HP", stats.maxHp),
    statLine("Max MP", stats.maxMp),
    statLine("Crit", stats.critChance === undefined ? undefined : stats.critChance * 100, "%"),
  ].filter((line): line is string => line !== null);
  const missingLevel = level < definition.levelReq;
  const missingClass =
    definition.classes !== "all" && classId !== undefined && !definition.classes.includes(classId);
  const width = 210;

  return (
    <div
      style={{
        position: "fixed",
        left: Math.min(Math.max(8, x + 14), window.innerWidth - width - 8),
        top: Math.min(Math.max(8, y + 12), window.innerHeight - 190),
        width,
        padding: "8px 10px",
        borderRadius: 7,
        border: theme.panelBorder,
        background: "rgba(12, 16, 15, 0.97)",
        boxShadow: "0 10px 28px rgba(0,0,0,0.65)",
        pointerEvents: "none",
        zIndex: 40,
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        color: theme.text,
      }}
    >
      <div style={{ color: RARITY_COLORS[definition.rarity], fontWeight: 700, marginBottom: 4 }}>
        {definition.name}
        {item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : ""}
      </div>
      <div style={{ color: theme.muted, marginBottom: 5 }}>
        {definition.type}
        {definition.stackable ? ` · ${item.quantity}/${definition.maxStack}` : ""}
      </div>
      {definition.description ? (
        <div style={{ color: theme.muted, fontStyle: "italic", marginBottom: 5 }}>
          {definition.description}
        </div>
      ) : null}
      {lines.map((line) => (
        <div key={line} style={{ color: "#8fd3b6" }}>
          {line}
        </div>
      ))}
      {definition.levelReq > 1 ? (
        <div style={{ color: missingLevel ? "#ff7a6e" : theme.muted, marginTop: 4 }}>
          Required level {definition.levelReq}
        </div>
      ) : null}
      {definition.classes !== "all" ? (
        <div style={{ color: missingClass ? "#ff7a6e" : theme.muted }}>
          Class: {definition.classes.join(", ")}
        </div>
      ) : null}
      {definition.sellPrice > 0 ? (
        <div style={{ color: theme.gold, marginTop: 5 }}>Sells for {definition.sellPrice} gold</div>
      ) : null}
    </div>
  );
}
