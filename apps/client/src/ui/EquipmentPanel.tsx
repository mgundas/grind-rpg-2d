import { EQUIP_SLOTS, RARITY_COLORS, itemNameColor, type ItemInstanceDto } from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { theme } from "./theme";

interface EquipmentPanelProps {
  equipment: (ItemInstanceDto | null)[];
  onUnequip: (slot: number) => void;
  onHover: (item: ItemInstanceDto | null, x: number, y: number) => void;
  onDragStart?: (item: ItemInstanceDto) => void;
  scrollMode?: boolean;
  onApplyScroll?: (item: ItemInstanceDto) => void;
}

/** Eight equipment slots; clicking a filled slot unequips it. */
export function EquipmentPanel({
  equipment,
  onUnequip,
  onHover,
  onDragStart,
  scrollMode = false,
  onApplyScroll,
}: EquipmentPanelProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 132 }}>
      <div style={{ color: theme.gold, fontSize: 11, fontWeight: 700, marginBottom: 2 }}>
        Equipment
      </div>
      {EQUIP_SLOTS.map((slotName, index) => {
        const item = equipment[index] ?? null;
        const definition = item && hasItem(item.itemId) ? getItem(item.itemId) : null;
        return (
          <button
            key={slotName}
            type="button"
            onClick={() => {
              if (!item) {
                return;
              }
              if (scrollMode && onApplyScroll) {
                onApplyScroll(item);
              } else {
                onUnequip(index);
              }
            }}
            onPointerDown={() => {
              if (item) {
                onDragStart?.(item);
              }
            }}
            onPointerEnter={(event) => {
              if (item) {
                onHover(item, event.clientX, event.clientY);
              }
            }}
            onPointerLeave={() => onHover(null, 0, 0)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 34,
              padding: "2px 5px",
              borderRadius: 5,
              border: definition
                ? `1px solid ${RARITY_COLORS[definition.rarity]}`
                : "1px solid rgba(255,255,255,0.08)",
              background: definition
                ? `linear-gradient(90deg, ${RARITY_COLORS[definition.rarity]}22, rgba(10,14,12,0.85))`
                : "rgba(10,14,12,0.55)",
              color: theme.text,
              cursor: item ? "pointer" : "default",
              fontFamily: "system-ui, sans-serif",
              textAlign: "left",
              overflow: "hidden",
            }}
            title={definition ? `${definition.name} (click to unequip)` : slotName}
          >
            <span style={{ width: 38, fontSize: 9, color: theme.muted, textTransform: "capitalize" }}>
              {slotName}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: definition ? itemNameColor(item?.bonuses.length ?? 0) : theme.muted,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {definition ? definition.name : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
