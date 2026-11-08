import { KINGDOMS } from "@jadethrone/shared";

/** Free players are always red; everyone else keeps their kingdom colour. */
export function playerNameColor(pvpMode: string | undefined, kingdom: string | undefined): string {
  if (pvpMode === "free") {
    return "#ff7a6e";
  }
  return KINGDOMS.find((entry) => entry.id === kingdom)?.color ?? "#cfd8d3";
}

export function pvpModeLabel(pvpMode: string | undefined): string {
  return pvpMode === "free" ? "Free" : pvpMode === "kingdom" ? "Kingdom" : "Peaceful";
}
