/**
 * Shared world-collision math used by both the server `worldCollisionSystem`
 * and the client's rewind-and-replay path. Kept dependency-free so it can be
 * imported from any environment (node, browser, tests).
 *
 * Players are treated as circles (center `(x, y)`, radius `r`). The arena is
 * an axis-aligned bounding box and static world blockers are axis-aligned rectangles.
 */

/** Axis-aligned bounds (inclusive min, exclusive max). */
export type ArenaBounds = {
  readonly width: number
  readonly height: number
}

/** A single static world blocker footprint in world pixels. */
export type ArenaPropColliderRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const MAX_COLLISION_PASSES = 4

/**
 * Computes the minimum-translation vector that pushes a circle out of an
 * axis-aligned rectangle. Returns `null` when the circle does not overlap.
 */
function circleRectMTV(
  cx: number,
  cy: number,
  cr: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): { dx: number; dy: number } | null {
  if (cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh) {
    const toLeft = cx - rx
    const toRight = rx + rw - cx
    const toTop = cy - ry
    const toBottom = ry + rh - cy
    const min = Math.min(toLeft, toRight, toTop, toBottom)

    if (min === toLeft) return { dx: -(toLeft + cr), dy: 0 }
    if (min === toRight) return { dx: toRight + cr, dy: 0 }
    if (min === toTop) return { dx: 0, dy: -(toTop + cr) }
    return { dx: 0, dy: toBottom + cr }
  }

  const nearX = Math.max(rx, Math.min(cx, rx + rw))
  const nearY = Math.max(ry, Math.min(cy, ry + rh))
  const dx = cx - nearX
  const dy = cy - nearY
  const distSq = dx * dx + dy * dy
  if (distSq >= cr * cr) return null

  const dist = Math.sqrt(distSq) || 0.001
  const pen = cr - dist
  return { dx: (dx / dist) * pen, dy: (dy / dist) * pen }
}

/**
 * Clamps a circle's center against arena bounds (respecting radius) and pushes
 * it out of any overlapping world rectangles. Pure function — caller passes in
 * the resulting `(x, y)` to wherever it's stored (ECS Position, client
 * ClientPosition, etc.).
 *
 * @param x - Circle center x in world pixels.
 * @param y - Circle center y in world pixels.
 * @param radius - Circle radius in world pixels.
 * @param bounds - Arena bounds `{ width, height }`.
 * @param worldColliders - Static world rectangles.
 * @returns Resolved `{ x, y }` position after all clamps / MTVs are applied.
 */
export function resolveAgainstWorld(
  x: number,
  y: number,
  radius: number,
  bounds: ArenaBounds,
  worldColliders: readonly ArenaPropColliderRect[],
): { x: number; y: number } {
  let cx = x
  let cy = y

  const minX = radius
  const minY = radius
  const maxX = bounds.width - radius
  const maxY = bounds.height - radius

  if (cx < minX) cx = minX
  if (cx > maxX) cx = maxX
  if (cy < minY) cy = minY
  if (cy > maxY) cy = maxY

  for (let pass = 0; pass < MAX_COLLISION_PASSES; pass++) {
    let moved = false
    for (const col of worldColliders) {
      const mtv = circleRectMTV(cx, cy, radius, col.x, col.y, col.width, col.height)
      if (mtv) {
        cx += mtv.dx
        cy += mtv.dy
        moved = true
      }
    }

    if (cx < minX) cx = minX
    if (cx > maxX) cx = maxX
    if (cy < minY) cy = minY
    if (cy > maxY) cy = maxY

    if (!moved) {
      break
    }
  }

  return { x: cx, y: cy }
}
