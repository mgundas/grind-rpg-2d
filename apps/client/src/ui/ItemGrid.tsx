import { RARITY_COLORS, equipSlotForItemType, isBonusScrollId, itemNameColor, type ItemInstanceDto } from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { theme } from "./theme";

interface ItemGridProps {
  items: ItemInstanceDto[];
  startSlot: number;
  slotCount: number;
  cellSize?: number;
  drag: DragState | null;
  onDragStart: (drag: DragState) => void;
  onDropAt: (slot: number) => void;
  onEquip: (instanceId: string) => void;
  onUse: (instanceId: string) => void;
  onHover: (item: ItemInstanceDto | null, x: number, y: number) => void;
  /** When true, a left click applies the selected scroll to this item. */
  scrollMode?: boolean;
  onApplyScroll?: (instanceId: string) => void;
  onSelectScroll?: (instanceId: string, itemId: string) => void;
}

export interface DragState {
  instanceId: string;
  quantity: number;
  split: boolean;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

/** One 5×9 page of the inventory grid. Multi-cell items span vertical rows. */
export function ItemGrid({
  items,
  startSlot,
  slotCount,
  cellSize = 38,
  drag,
  onDragStart,
  onDropAt,
  onEquip,
  onUse,
  onHover,
  scrollMode = false,
  onApplyScroll,
  onSelectScroll,
}: ItemGridProps) {
  const pageItems = items.filter(
    (item) => item.slot >= startSlot && item.slot < startSlot + slotCount,
  );

  return (
    <div
      style={{
        position: "relative",
        width: 5 * cellSize,
        height: 9 * cellSize,
        background:
          "repeating-linear-gradient(0deg, rgba(255,255,255,0.03), rgba(255,255,255,0.03) 1px, transparent 1px, transparent " +
          `${cellSize}px), repeating-linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,255,255,0.03) 1px, transparent 1px, transparent ${cellSize}px)`,
        border: theme.panelBorder,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: slotCount }, (_, index) => {
        const slot = startSlot + index;
        const row = Math.floor(index / 5);
        const col = index % 5;
        return (
          <button
            key={slot}
            type="button"
            aria-label={`Inventory slot ${slot}`}
            onPointerUp={(event) => {
              event.stopPropagation();
              if (drag) {
                onDropAt(slot);
              }
            }}
            style={{
              position: "absolute",
              left: col * cellSize,
              top: row * cellSize,
              width: cellSize,
              height: cellSize,
              border: "1px solid rgba(255,255,255,0.04)",
              background: "transparent",
              cursor: drag ? "grabbing" : "default",
              padding: 0,
            }}
          />
        );
      })}

      {pageItems.map((item) => {
        if (!hasItem(item.itemId)) {
          return null;
        }
        const definition = getItem(item.itemId);
        const relative = item.slot - startSlot;
        const row = Math.floor(relative / 5);
        const col = relative % 5;
        const height = definition.size * cellSize;
        return (
          <button
            key={item.id}
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (scrollMode && onApplyScroll) {
                onApplyScroll(item.id);
                return;
              }
              onDragStart({
                instanceId: item.id,
                quantity: item.quantity,
                split: event.shiftKey && item.quantity > 1,
              });
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              if (drag && drag.instanceId !== item.id) {
                onDropAt(item.slot);
              }
            }}
            onPointerEnter={(event) => onHover(item, event.clientX, event.clientY)}
            onPointerMove={(event) => onHover(item, event.clientX, event.clientY)}
            onPointerLeave={() => onHover(null, 0, 0)}
            onContextMenu={(event) => {
              event.preventDefault();
              if (isBonusScrollId(item.itemId)) {
                onSelectScroll?.(item.id, item.itemId);
              } else if (equipSlotForItemType(definition.type)) {
                onEquip(item.id);
              } else if (definition.effect) {
                onUse(item.id);
              }
            }}
            style={{
              position: "absolute",
              left: col * cellSize + 2,
              top: row * cellSize + 2,
              width: cellSize - 4,
              height: height - 4,
              borderRadius: 5,
              border: `1px solid ${RARITY_COLORS[definition.rarity]}`,
              background: `linear-gradient(180deg, ${RARITY_COLORS[definition.rarity]}33, rgba(10,14,12,0.9))`,
              color: theme.text,
              cursor: "grab",
              padding: 2,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
              fontFamily: "system-ui, sans-serif",
              userSelect: "none",
              boxSizing: "border-box",
            }}
            title={definition.name}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: itemNameColor(item.bonuses.length) }}>
              {initials(definition.name)}
            </span>
            <span style={{ fontSize: 8, color: theme.muted, lineHeight: 1.1, textAlign: "center" }}>
              {definition.name.length > 14 ? `${definition.name.slice(0, 13)}…` : definition.name}
            </span>
            {item.quantity > 1 ? (
              <span
                style={{
                  position: "absolute",
                  right: 2,
                  bottom: 1,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#fff",
                  textShadow: "0 1px 2px #000",
                }}
              >
                {item.quantity}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
