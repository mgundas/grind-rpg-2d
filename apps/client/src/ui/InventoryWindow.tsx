import { useEffect, useState } from "react";
import type { ItemInstanceDto } from "@jadethrone/shared";
import {
  sendEquipItem,
  sendMoveItem,
  sendSplitStack,
  sendUnequipItem,
  sendUseItem,
} from "../network/session";
import { EquipmentPanel } from "./EquipmentPanel";
import { ItemGrid } from "./ItemGrid";
import { ItemTooltip } from "./ItemTooltip";
import { useUiStore } from "./store";
import { theme } from "./theme";
import { Window } from "./Window";

interface Hover {
  item: ItemInstanceDto;
  x: number;
  y: number;
}

export function InventoryWindow() {
  const open = useUiStore((state) => state.inventoryOpen);
  const setOpen = useUiStore((state) => state.setInventoryOpen);
  const inventory = useUiStore((state) => state.inventory);
  const error = useUiStore((state) => state.inventoryError);
  const setError = useUiStore((state) => state.setInventoryError);
  const autoLoot = useUiStore((state) => state.autoLoot);
  const setAutoLoot = useUiStore((state) => state.setAutoLoot);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => setError(null), 2600);
    return () => clearTimeout(timer);
  }, [error, setError]);

  if (!open) {
    return null;
  }

  const items = inventory?.items ?? [];

  return (
    <>
      <Window id="inventory" title="Inventory" width={605} onClose={() => setOpen(false)}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            fontFamily: "system-ui, sans-serif",
            fontSize: 12,
          }}
        >
          <span style={{ color: theme.gold, fontWeight: 700 }}>
            {inventory ? `${inventory.gold.toLocaleString()} Gold` : "Loading…"}
          </span>
          <label style={{ color: theme.muted, display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={autoLoot}
              onChange={(event) => setAutoLoot(event.target.checked)}
            />
            Auto-loot owned drops
          </label>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <ItemGrid
            items={items}
            startSlot={0}
            slotCount={45}
            onMove={sendMoveItem}
            onSplit={sendSplitStack}
            onEquip={sendEquipItem}
            onUse={sendUseItem}
            onHover={(item, x, y) => setHover(item ? { item, x, y } : null)}
          />
          <ItemGrid
            items={items}
            startSlot={45}
            slotCount={45}
            onMove={sendMoveItem}
            onSplit={sendSplitStack}
            onEquip={sendEquipItem}
            onUse={sendUseItem}
            onHover={(item, x, y) => setHover(item ? { item, x, y } : null)}
          />
          <EquipmentPanel
            equipment={inventory?.equipment ?? Array.from({ length: 8 }, () => null)}
            onUnequip={sendUnequipItem}
            onHover={(item, x, y) => setHover(item ? { item, x, y } : null)}
          />
        </div>

        <div
          style={{
            marginTop: 8,
            fontSize: 10,
            color: theme.muted,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Drag to move, Shift+drag to split, right-click to equip or use.
        </div>

        {error ? (
          <div
            style={{
              marginTop: 6,
              color: "#ff8f84",
              fontSize: 11,
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {error.code.replaceAll("_", " ")}
          </div>
        ) : null}
      </Window>
      {hover ? <ItemTooltip item={hover.item} x={hover.x} y={hover.y} /> : null}
    </>
  );
}

/** Global inventory hotkey (I); ignored while chat owns the keyboard. */
export function useInventoryHotkey(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useUiStore.getState();
      if (store.chatFocused) {
        return;
      }
      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        store.toggleInventory();
      } else if (event.key === "Escape" && store.inventoryOpen) {
        store.setInventoryOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
