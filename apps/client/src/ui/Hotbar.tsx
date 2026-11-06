import { useEffect, useMemo, useState } from "react";
import { RARITY_COLORS, type ItemInstanceDto } from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { sendUseItem } from "../network/session";
import { HOTBAR_SLOT_COUNT, loadHotbar, saveHotbar, type HotbarBindings } from "./hotbarStorage";
import { useUiStore } from "./store";
import { theme } from "./theme";

const KEY_LABELS = ["1", "2", "3", "4", "F1", "F2", "F3", "F4"];

function keyForSlot(index: number): string {
  return KEY_LABELS[index] ?? "";
}

/** Eight consumable slots; drag an item from the inventory to bind it. */
export function Hotbar() {
  const characterId = useUiStore((state) => state.selectedCharacterId);
  const inventory = useUiStore((state) => state.inventory);
  const [bindingsByCharacter, setBindingsByCharacter] = useState<
    Record<string, HotbarBindings>
  >({});
  const draggedItemId = useUiStore((state) => state.draggedItemId);
  const setDraggedItemId = useUiStore((state) => state.setDraggedItemId);
  const bindings = characterId
    ? (bindingsByCharacter[characterId] ?? loadHotbar(characterId))
    : loadHotbar(null);

  function updateBindings(next: HotbarBindings): void {
    if (!characterId) {
      return;
    }
    setBindingsByCharacter((current) => ({ ...current, [characterId]: next }));
    saveHotbar(characterId, next);
  }

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inventory?.items ?? []) {
      map.set(item.itemId, (map.get(item.itemId) ?? 0) + item.quantity);
    }
    return map;
  }, [inventory]);

  function triggerSlot(index: number): void {
    const itemId = bindings[index];
    if (!itemId) {
      return;
    }
    const item = [...(inventory?.items ?? [])].find((entry) => entry.itemId === itemId);
    if (item) {
      sendUseItem(item.id);
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useUiStore.getState();
      if (store.chatFocused || store.dead) {
        return;
      }
      const index = KEY_LABELS.indexOf(event.key.toUpperCase());
      if (index >= 0) {
        event.preventDefault();
        triggerSlot(index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 104,
        transform: "translateX(-50%)",
        display: "flex",
        gap: 4,
        padding: 5,
        borderRadius: 8,
        border: theme.panelBorder,
        background: "rgba(13, 18, 16, 0.92)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.5)",
        pointerEvents: "auto",
        zIndex: 15,
      }}
    >
      {Array.from({ length: HOTBAR_SLOT_COUNT }, (_, index) => {
        const itemId = bindings[index] ?? null;
        const definition = itemId && hasItem(itemId) ? getItem(itemId) : null;
        const count = itemId ? (counts.get(itemId) ?? 0) : 0;
        const item: ItemInstanceDto | undefined = itemId
          ? (inventory?.items ?? []).find((entry) => entry.itemId === itemId)
          : undefined;
        return (
          <button
            key={index}
            type="button"
            onClick={() => triggerSlot(index)}
            onPointerUp={(event) => {
              if (!draggedItemId || !hasItem(draggedItemId)) {
                return;
              }
              event.stopPropagation();
              const next = [...bindings];
              next[index] = draggedItemId;
              updateBindings(next);
              setDraggedItemId(null);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              const next = [...bindings];
              next[index] = null;
              updateBindings(next);
            }}
            style={{
              position: "relative",
              width: 46,
              height: 46,
              borderRadius: 6,
              border: definition
                ? `1px solid ${RARITY_COLORS[definition.rarity]}`
                : "1px solid rgba(255,255,255,0.12)",
              background: definition
                ? `linear-gradient(180deg, ${RARITY_COLORS[definition.rarity]}33, rgba(10,14,12,0.9))`
                : "rgba(8,11,10,0.75)",
              color: theme.text,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
              padding: 2,
              opacity: item || !itemId ? 1 : 0.45,
            }}
            title={definition ? `${definition.name} (${count})` : `Hotbar ${keyForSlot(index)}`}
          >
            <span
              style={{
                position: "absolute",
                left: 3,
                top: 1,
                fontSize: 9,
                color: theme.gold,
                fontWeight: 700,
              }}
            >
              {keyForSlot(index)}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700 }}>
              {definition ? definition.name.slice(0, 5) : ""}
            </span>
            {count > 1 || item ? (
              <span
                style={{
                  position: "absolute",
                  right: 3,
                  bottom: 1,
                  fontSize: 10,
                  color: "#fff",
                  textShadow: "0 1px 2px #000",
                }}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
