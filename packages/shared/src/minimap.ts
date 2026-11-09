/** World → minimap projection (top-left origin, uniform scale to fit). */
export interface MinimapPoint {
  x: number;
  y: number;
}

export interface MinimapTransform {
  mapWidthPx: number;
  mapHeightPx: number;
  width: number;
  height: number;
}

export function projectToMinimap(
  x: number,
  y: number,
  transform: MinimapTransform,
): MinimapPoint {
  if (transform.mapWidthPx <= 0 || transform.mapHeightPx <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(0, Math.min(transform.width, (x / transform.mapWidthPx) * transform.width)),
    y: Math.max(
      0,
      Math.min(transform.height, (y / transform.mapHeightPx) * transform.height),
    ),
  };
}

/** Pixel radius of an entity dot, kept visible at small minimap sizes. */
export function minimapDotRadius(width: number): number {
  return Math.max(1.5, Math.min(4, width / 60));
}
