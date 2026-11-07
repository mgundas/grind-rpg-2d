import { RARITY_COLORS, type ItemInstanceDto } from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";

export function AdminItemTooltip({
  item,
  x,
  y,
}: {
  item: ItemInstanceDto;
  x: number;
  y: number;
}) {
  if (!hasItem(item.itemId)) {
    return null;
  }
  const definition = getItem(item.itemId);
  const stats = definition.baseStats ?? {};
  return (
    <div
      className="pointer-events-none fixed z-50 w-56 rounded border border-[var(--jade-soft)] bg-[#0c100f] p-2 text-xs shadow-[0_10px_28px_rgba(0,0,0,0.65)]"
      style={{
        left: Math.min(Math.max(8, x + 14), window.innerWidth - 240),
        top: Math.min(Math.max(8, y + 12), window.innerHeight - 180),
      }}
    >
      <div className="font-semibold" style={{ color: RARITY_COLORS[definition.rarity] }}>
        {definition.name}
        {item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : ""}
      </div>
      <div className="mt-1 text-[#7d8a84]">
        {definition.type}
        {definition.stackable ? ` · ${item.quantity}/${definition.maxStack}` : ""}
      </div>
      {Object.entries(stats).map(([key, value]) => (
        <div key={key} className="text-[#8fd3b6]">
          {key} +{value}
        </div>
      ))}
      {item.bonuses.map((bonus, index) => (
        <div key={`${bonus.type}-${index}`} className="text-[#9b6bd1]">
          {bonus.type} +{bonus.value}
        </div>
      ))}
      <div className="mt-1 text-[var(--gold)]">Sells for {definition.sellPrice}g</div>
    </div>
  );
}
