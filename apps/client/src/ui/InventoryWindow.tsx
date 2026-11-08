import { useEffect, useState } from "react";
import { BONUS_SCROLL_IDS, type ItemInstanceDto } from "@jadethrone/shared";
import {
  sendApplyBonusScroll,
  sendEquipItem,
  sendMoveItem,
  sendSplitStack,
  sendUnequipItem,
  sendUseItem,
} from "../network/session";
import { EquipmentPanel } from "./EquipmentPanel";
import { ItemGrid, type DragState } from "./ItemGrid";
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
  const setDraggedItemId = useUiStore((state) => state.setDraggedItemId);
  const setDraggedInstanceId = useUiStore((state) => state.setDraggedInstanceId);
  const scrollTarget = useUiStore((state) => state.scrollTarget);
  const beginScrollTarget = useUiStore((state) => state.beginScrollTarget);
  const cancelScrollTarget = useUiStore((state) => state.cancelScrollTarget);
  const bonusScrollResult = useUiStore((state) => state.bonusScrollResult);
  const setBonusScrollResult = useUiStore((state) => state.setBonusScrollResult);
  const beginSkillBook = useUiStore((state) => state.beginSkillBook);
  const setSkillWindowOpen = useUiStore((state) => state.setSkillWindowOpen);
  const [hover, setHover] = useState<Hover | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => setError(null), 2600);
    return () => clearTimeout(timer);
  }, [error, setError]);

  useEffect(() => {
    if (!bonusScrollResult) {
      return;
    }
    const timer = setTimeout(() => setBonusScrollResult(null), 5000);
    return () => clearTimeout(timer);
  }, [bonusScrollResult, setBonusScrollResult]);

  useEffect(() => {
    const clear = () => {
      setDrag(null);
      setDraggedItemId(null);
      setDraggedInstanceId(null);
    };
    window.addEventListener("pointerup", clear);
    return () => window.removeEventListener("pointerup", clear);
  }, [setDraggedItemId, setDraggedInstanceId]);

  if (!open) {
    return null;
  }

  const items = inventory?.items ?? [];
  const startDrag = (next: DragState) => {
    setDrag(next);
    setDraggedItemId(items.find((item) => item.id === next.instanceId)?.itemId ?? null);
    setDraggedInstanceId(next.instanceId);
  };

  const handleDrop = (slot: number) => {
    if (!drag) {
      return;
    }
    if (drag.split) {
      sendSplitStack(drag.instanceId, Math.max(1, Math.floor(drag.quantity / 2)), slot);
    } else {
      sendMoveItem(drag.instanceId, slot);
    }
    setDrag(null);
  };

  const applyScrollTo = (instanceId: string) => {
    if (!scrollTarget.active || scrollTarget.scrollInstanceId === instanceId) {
      return;
    }
    sendApplyBonusScroll(scrollTarget.scrollInstanceId, instanceId);
  };

  return (
    <>
      <Window
        id="inventory"
        title="Inventory"
        width={605}
        onClose={() => {
          cancelScrollTarget();
          setOpen(false);
        }}
      >
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

        {scrollTarget.active ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              padding: "5px 8px",
              borderRadius: 5,
              border: "1px solid rgba(93,168,143,0.55)",
              background: "rgba(93,168,143,0.12)",
              fontSize: 11,
              color: theme.text,
            }}
          >
            <span>
              Select an item to apply{" "}
              {scrollTarget.scrollItemId === BONUS_SCROLL_IDS.enchant ? "Enchant" : "Reinforce"} Scroll
            </span>
            <button type="button" style={{ padding: "2px 8px", fontSize: 10 }} onClick={cancelScrollTarget}>
              Cancel (Esc)
            </button>
          </div>
        ) : null}

        {bonusScrollResult ? (
          <div
            style={{
              marginBottom: 8,
              padding: "5px 8px",
              borderRadius: 5,
              border: "1px solid rgba(93,168,143,0.55)",
              background: "rgba(93,168,143,0.12)",
              fontSize: 11,
              color: theme.jade,
            }}
          >
            {bonusScrollResult.kind === "enchant" ? "Enchant" : "Reinforce"} applied:{" "}
            {bonusScrollResult.bonuses
              .map((bonus) => `${bonus.type.replaceAll("_", " ")} +${bonus.value}`)
              .join(", ")}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 12 }}>
          <ItemGrid
            items={items}
            startSlot={0}
            slotCount={45}
            drag={drag}
            onDragStart={startDrag}
            onDropAt={handleDrop}
            onEquip={sendEquipItem}
            onUse={sendUseItem}
            onHover={(item, x, y) => setHover(item ? { item, x, y } : null)}
            scrollMode={scrollTarget.active}
            onApplyScroll={applyScrollTo}
            onSelectScroll={(instanceId, itemId) => beginScrollTarget(instanceId, itemId)}
            onSelectSkillBook={(instanceId) => {
              beginSkillBook(instanceId);
              setSkillWindowOpen(true);
            }}
          />
          <ItemGrid
            items={items}
            startSlot={45}
            slotCount={45}
            drag={drag}
            onDragStart={startDrag}
            onDropAt={handleDrop}
            onEquip={sendEquipItem}
            onUse={sendUseItem}
            onHover={(item, x, y) => setHover(item ? { item, x, y } : null)}
            scrollMode={scrollTarget.active}
            onApplyScroll={applyScrollTo}
            onSelectScroll={(instanceId, itemId) => beginScrollTarget(instanceId, itemId)}
            onSelectSkillBook={(instanceId) => {
              beginSkillBook(instanceId);
              setSkillWindowOpen(true);
            }}
          />
          <EquipmentPanel
            equipment={inventory?.equipment ?? Array.from({ length: 8 }, () => null)}
            onUnequip={sendUnequipItem}
            onHover={(item, x, y) => setHover(item ? { item, x, y } : null)}
            onDragStart={(item) => {
              setDraggedItemId(item.itemId);
              setDraggedInstanceId(item.id);
            }}
            scrollMode={scrollTarget.active}
            onApplyScroll={(item) => applyScrollTo(item.id)}
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
      } else if (event.key === "Escape" && store.scrollTarget.active) {
        // Cancel scroll targeting before closing the inventory.
        store.cancelScrollTarget();
      } else if (event.key === "Escape" && store.inventoryOpen) {
        store.setInventoryOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
