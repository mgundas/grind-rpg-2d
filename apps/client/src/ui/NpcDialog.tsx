import { sendTeleport, sendWarehouseOpen } from "../network/session";
import { useUiStore } from "./store";
import { theme } from "./theme";
import { Window } from "./Window";

/** Simple NPC conversation card; shops and warehouse open their windows. */
export function NpcDialog() {
  const dialog = useUiStore((state) => state.npcDialog);
  const teleportError = useUiStore((state) => state.teleportError);
  const setDialog = useUiStore((state) => state.setNpcDialog);
  const setShopId = useUiStore((state) => state.setShopId);
  const setWarehouseOpen = useUiStore((state) => state.setWarehouseOpen);
  const setBlacksmithOpen = useUiStore((state) => state.setBlacksmithOpen);

  if (!dialog) {
    return null;
  }

  return (
    <Window id="npc-dialog" title={dialog.name} width={320} onClose={() => setDialog(null)}>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: theme.text, lineHeight: 1.5 }}>
        {dialog.greeting}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        {dialog.kind === "shop" && dialog.shopId ? (
          <button
            type="button"
            onClick={() => {
              setShopId(dialog.shopId ?? null);
              setDialog(null);
            }}
            style={{ flex: 1 }}
          >
            Browse wares
          </button>
        ) : null}
        {dialog.kind === "warehouse" ? (
          <button
            type="button"
            onClick={() => {
              sendWarehouseOpen(dialog.npcId);
              setWarehouseOpen(true);
              setDialog(null);
            }}
            style={{ flex: 1 }}
          >
            Open storage
          </button>
        ) : null}
        {dialog.kind === "blacksmith" ? (
          <button
            type="button"
            onClick={() => {
              setBlacksmithOpen(true);
              setDialog(null);
            }}
            style={{ flex: 1 }}
          >
            Use the forge
          </button>
        ) : null}
        <button type="button" onClick={() => setDialog(null)} style={{ flex: 1 }}>
          Leave
        </button>
      </div>
      {dialog.kind === "teleporter" ? (
        <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
          {(dialog.destinations ?? []).map((destination) => (
            <button
              key={destination.mapId}
              type="button"
              onClick={() => sendTeleport(dialog.npcId, destination.mapId)}
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span>{destination.label}</span>
              <span style={{ color: destination.cost > 0 ? theme.gold : theme.jade }}>
                {destination.cost > 0 ? `${destination.cost.toLocaleString()} gold` : "free"}
              </span>
            </button>
          ))}
          {teleportError ? (
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#d9453a" }}>
              {teleportMessage(teleportError.code)}
            </p>
          ) : null}
        </div>
      ) : null}
    </Window>
  );
}

function teleportMessage(code: string): string {
  switch (code) {
    case "no_gold":
      return "You cannot afford that road.";
    case "out_of_range":
      return "Walk closer to the waykeeper.";
    case "invalid_target":
      return "No road leads there from here.";
    case "dead":
      return "The dead cannot travel.";
    case "cooldown":
      return "Wait a moment before travelling again.";
    default:
      return "The road is closed for now.";
  }
}
