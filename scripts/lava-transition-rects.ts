/**
 * Derives thin "lava boundary" rectangles from the arena tilemap: `NonWalkableAreas`
 * objects that overlap lava but are not almost entirely submerged (so they act
 * as land-facing barriers while the player is in `terrainState === "lava"`).
 */

/**
 * Axis-aligned rectangle in world pixels (Tiled-style origin).
 */
export type ColliderRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Returns the axis-aligned intersection area of two rectangles, or `0` if disjoint.
 *
 * @param a - First rectangle.
 * @param b - Second rectangle.
 * @returns Intersection area in square pixels.
 */
export function rectIntersectionArea(
  a: ColliderRect,
  b: ColliderRect,
): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  if (x2 <= x1 || y2 <= y1) return 0
  return (x2 - x1) * (y2 - y1)
}

/**
 * Selects non-walkable rects that overlap lava but extend meaningfully outside it
 * (overlap fraction of the non-walkable rect is below `overlapMaxFrac`).
 *
 * @param nonWalkable - Editor `NonWalkableAreas` rectangles.
 * @param lava - Hybrid lava footprint (tiles + `LavaAreas` objects), same as hazard export.
 * @param overlapMaxFrac - Reject rects that are more than this fraction covered by lava (interior fill).
 * @returns Boundary rectangles safe to add as extra blockers while submerged in lava.
 */
export function lavaTransitionRectsFromNonWalkableAndLava(
  nonWalkable: readonly ColliderRect[],
  lava: readonly ColliderRect[],
  overlapMaxFrac = 0.95,
): ColliderRect[] {
  const out: ColliderRect[] = []
  for (const nw of nonWalkable) {
    const nwArea = nw.width * nw.height
    if (nwArea <= 0) continue
    let lavaOverlapFrac = 0
    for (const l of lava) {
      const ia = rectIntersectionArea(nw, l)
      if (ia > 0) lavaOverlapFrac = Math.max(lavaOverlapFrac, ia / nwArea)
    }
    if (lavaOverlapFrac > 0 && lavaOverlapFrac < overlapMaxFrac) {
      out.push(nw)
    }
  }
  return out
}
