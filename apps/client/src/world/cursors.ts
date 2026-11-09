/**
 * Context cursors (GAME_DESIGN.md §11): sword over monsters, hand over NPCs,
 * bag over ground items. SVG data URIs avoid shipping cursor image files; the
 * hotspot is the visual tip of the icon.
 */

function svgCursor(svg: string, hotspotX: number, hotspotY: number, fallback: string): string {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}") ${hotspotX} ${hotspotY}, ${fallback}`;
}

const SWORD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 21l3-1 11-11-3-3L3 17z" fill="#dfe7e2" stroke="#0b0f0d" stroke-width="1.5"/><path d="M14 3l7 7" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/></svg>`;

const BAG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 9h14l-1.5 11h-11z" fill="#8a6a4a" stroke="#0b0f0d" stroke-width="1.5"/><path d="M8 9a4 4 0 018 0" fill="none" stroke="#c9a227" stroke-width="2"/></svg>`;

export const CURSOR_SWORD = svgCursor(SWORD_SVG, 3, 21, "crosshair");
export const CURSOR_BAG = svgCursor(BAG_SVG, 12, 19, "pointer");
export const CURSOR_HAND = "pointer";
export const CURSOR_DEFAULT = "default";
