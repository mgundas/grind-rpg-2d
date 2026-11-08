import { RARITY_COLORS, WAREHOUSE_PAGES, itemNameColor } from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { sendWarehouseDeposit, sendWarehouseWithdraw } from "../network/session";
import { useUiStore } from "./store";
import { theme } from "./theme";
import { Window } from "./Window";

function ItemRow({
  itemId,
  quantity,
  bonuses,
  action,
  onAction,
}: {
  itemId: string;
  quantity: number;
  bonuses?: readonly { type: string; value: number }[];
  action: string;
  onAction: () => void;
}) {
  if (!hasItem(itemId)) {
    return null;
  }
  const definition = getItem(itemId);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 6px",
        border: `1px solid ${RARITY_COLORS[definition.rarity]}44`,
        borderRadius: 4,
        fontSize: 10,
      }}
    >
      <span style={{ color: itemNameColor(bonuses?.length ?? 0) }}>
        {definition.name}
        {quantity > 1 ? ` ×${quantity}` : ""}
      </span>
      <button type="button" style={{ fontSize: 9, padding: "1px 5px" }} onClick={onAction}>
        {action}
      </button>
    </div>
  );
}

/** Account warehouse (3 pages) beside the character inventory. */
export function WarehouseWindow() {
  const open = useUiStore((state) => state.warehouseOpen);
  const setOpen = useUiStore((state) => state.setWarehouseOpen);
  const warehouse = useUiStore((state) => state.warehouse);
  const inventory = useUiStore((state) => state.inventory);

  if (!open) {
    return null;
  }

  return (
    <Window id="warehouse" title="Warehouse" width={520} onClose={() => setOpen(false)}>
      <div style={{ display: "flex", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: theme.gold, fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
            Stored ({WAREHOUSE_PAGES} pages)
          </div>
          <div style={{ display: "grid", gap: 3, maxHeight: 320, overflowY: "auto" }}>
            {warehouse?.items.length ? (
              warehouse.items.map((item) => (
                <ItemRow
                  key={item.id}
                  itemId={item.itemId}
                  quantity={item.quantity}
                  bonuses={item.bonuses}
                  action="Withdraw"
                  onAction={() => sendWarehouseWithdraw(item.id)}
                />
              ))
            ) : (
              <span style={{ color: theme.muted, fontSize: 10 }}>Empty</span>
            )}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: theme.gold, fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
            Inventory
          </div>
          <div style={{ display: "grid", gap: 3, maxHeight: 320, overflowY: "auto" }}>
            {(inventory?.items ?? []).map((item) => (
              <ItemRow
                key={item.id}
                itemId={item.itemId}
                quantity={item.quantity}
                bonuses={item.bonuses}
                action="Deposit"
                onAction={() => sendWarehouseDeposit(item.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </Window>
  );
}
