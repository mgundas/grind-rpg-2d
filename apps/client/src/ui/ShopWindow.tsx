import { useState } from "react";
import { RARITY_COLORS, itemNameColor } from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { getShop } from "@jadethrone/data/shops";
import { sendShopBuy, sendShopSell } from "../network/session";
import { useUiStore } from "./store";
import { theme } from "./theme";
import { Window } from "./Window";

/** General-goods / weaponsmith / armorer shop window with buy and sell tabs. */
export function ShopWindow() {
  const shopId = useUiStore((state) => state.shopId);
  const setShopId = useUiStore((state) => state.setShopId);
  const inventory = useUiStore((state) => state.inventory);
  const [tab, setTab] = useState<"buy" | "sell">("buy");

  if (!shopId) {
    return null;
  }
  let shop;
  try {
    shop = getShop(shopId);
  } catch {
    return null;
  }
  const gold = inventory?.gold ?? 0;

  return (
    <Window id="shop" title={shop.name} width={430} onClose={() => setShopId(null)}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => setTab("buy")} disabled={tab === "buy"}>
            Buy
          </button>
          <button type="button" onClick={() => setTab("sell")} disabled={tab === "sell"}>
            Sell
          </button>
        </div>
        <span style={{ color: theme.gold, fontWeight: 700 }}>{gold.toLocaleString()} Gold</span>
      </div>

      <div style={{ display: "grid", gap: 4, maxHeight: 360, overflowY: "auto" }}>
        {tab === "buy"
          ? shop.items.map((entry) => {
              const definition = hasItem(entry.itemId) ? getItem(entry.itemId) : null;
              if (!definition) {
                return null;
              }
              return (
                <button
                  key={entry.itemId}
                  type="button"
                  onClick={() => sendShopBuy(shop.id, entry.itemId, 1)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "5px 8px",
                    border: `1px solid ${RARITY_COLORS[definition.rarity]}55`,
                    borderRadius: 5,
                    background: "rgba(10,14,12,0.7)",
                    color: theme.text,
                    cursor: "pointer",
                    fontSize: 11,
                    textAlign: "left",
                  }}
                >
                  <span style={{ color: itemNameColor(0), fontWeight: 700 }}>
                    {definition.name}
                  </span>
                  <span style={{ color: theme.gold }}>{definition.buyPrice}g</span>
                </button>
              );
            })
          : (inventory?.items ?? [])
              .filter((item) => hasItem(item.itemId) && getItem(item.itemId).sellPrice > 0)
              .map((item) => {
                const definition = getItem(item.itemId);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => sendShopSell(item.id, 1)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "5px 8px",
                      border: `1px solid ${RARITY_COLORS[definition.rarity]}55`,
                      borderRadius: 5,
                      background: "rgba(10,14,12,0.7)",
                      color: theme.text,
                      cursor: "pointer",
                      fontSize: 11,
                      textAlign: "left",
                    }}
                  >
                    <span>
                      {definition.name}
                      {item.quantity > 1 ? ` ×${item.quantity}` : ""}
                    </span>
                    <span style={{ color: theme.gold }}>{definition.sellPrice}g</span>
                  </button>
                );
              })}
      </div>
    </Window>
  );
}
