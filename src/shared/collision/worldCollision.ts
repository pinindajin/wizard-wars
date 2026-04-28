/**
 * Shared world-collision math used by both the server `worldCollisionSystem`
 * and the client's rewind-and-replay path. Kept dependency-free so it can be
 * imported from any environment (node, browser, tests).
 *
 * Players are treated as axis-aligned ellipses for world collision. The arena
 * is an axis-aligned bounding box and static world blockers are axis-aligned rectangles.
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

/** Axis-aligned oval footprint radii used for player world collision. */
export type WorldCollisionFootprint = {
  readonly radiusX: number
  readonly radiusY: number
}

/** Result of a candidate-gated world movement step. */
export type WorldMoveResult = {
  /** Final legal footprint center x. */
  readonly x: number
  /** Final legal footprint center y. */
  readonly y: number
  /** Applied x delta from the original position. */
  readonly appliedDx: number
  /** Applied y delta from the original position. */
  readonly appliedDy: number
  /** Whether the requested x step was rejected. */
  readonly blockedX: boolean
  /** Whether the requested y step was rejected. */
  readonly blockedY: boolean
}

const MAX_COLLISION_PASSES = 4

/**
 * Computes the minimum-translation vector that pushes a unit circle out of an
 * axis-aligned rectangle. Returns `null` when the circle does not overlap.
 */
function unitCircleRectMTV(
  cx: number,
  cy: number,
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

    if (min === toLeft) return { dx: -(toLeft + 1), dy: 0 }
    if (min === toRight) return { dx: toRight + 1, dy: 0 }
    if (min === toTop) return { dx: 0, dy: -(toTop + 1) }
    return { dx: 0, dy: toBottom + 1 }
  }

  const nearX = Math.max(rx, Math.min(cx, rx + rw))
  const nearY = Math.max(ry, Math.min(cy, ry + rh))
  const dx = cx - nearX
  const dy = cy - nearY
  const distSq = dx * dx + dy * dy
  if (distSq >= 1) return null

  const dist = Math.sqrt(distSq)
  const pen = 1 - dist
  return { dx: (dx / dist) * pen, dy: (dy / dist) * pen }
}

/**
 * Computes the minimum-translation vector that pushes an ellipse out of an
 * axis-aligned rectangle by scaling the world into unit-circle space.
 *
 * @param cx - Ellipse center x in world pixels.
 * @param cy - Ellipse center y in world pixels.
 * @param footprint - Ellipse radii in world pixels.
 * @param rect - Static world blocker rectangle.
 * @returns World-space MTV, or `null` when the ellipse does not overlap.
 */
function ellipseRectMTV(
  cx: number,
  cy: number,
  footprint: WorldCollisionFootprint,
  rect: ArenaPropColliderRect,
): { dx: number; dy: number } | null {
  const mtv = unitCircleRectMTV(
    cx / footprint.radiusX,
    cy / footprint.radiusY,
    rect.x / footprint.radiusX,
    rect.y / footprint.radiusY,
    rect.width / footprint.radiusX,
    rect.height / footprint.radiusY,
  )

  if (!mtv) return null
  return {
    dx: mtv.dx * footprint.radiusX,
    dy: mtv.dy * footprint.radiusY,
  }
}

/**
 * Returns whether a player footprint may occupy the provided world position
 * without crossing arena bounds or overlapping a static blocker.
 *
 * @param x - Candidate footprint center x in world pixels.
 * @param y - Candidate footprint center y in world pixels.
 * @param footprint - Axis-aligned oval footprint radii in world pixels.
 * @param bounds - Arena bounds `{ width, height }`.
 * @param worldColliders - Static world rectangles.
 * @returns Whether the candidate position is legal. Exact touches are legal.
 */
export function canOccupyWorldPosition(
  x: number,
  y: number,
  footprint: WorldCollisionFootprint,
  bounds: ArenaBounds,
  worldColliders: readonly ArenaPropColliderRect[],
): boolean {
  if (x < footprint.radiusX || x > bounds.width - footprint.radiusX) return false
  if (y < footprint.radiusY || y > bounds.height - footprint.radiusY) return false

  for (const col of worldColliders) {
    if (ellipseRectMTV(x, y, footprint, col)) {
      return false
    }
  }

  return true
}

/**
 * Applies a candidate-gated movement step without allowing the circle to enter
 * blockers. The start position is expected to already be legal; callers that
 * need to recover from an illegal start should run `resolveAgainstWorld`.
 *
 * @param x - Starting circle center x in world pixels.
 * @param y - Starting circle center y in world pixels.
 * @param stepX - Requested x delta for this movement tick.
 * @param stepY - Requested y delta for this movement tick.
 * @param footprint - Axis-aligned oval footprint radii in world pixels.
 * @param bounds - Arena bounds `{ width, height }`.
 * @param worldColliders - Static world rectangles.
 * @returns Final legal position plus the actually-applied movement delta.
 */
export function moveWithinWorld(
  x: number,
  y: number,
  stepX: number,
  stepY: number,
  footprint: WorldCollisionFootprint,
  bounds: ArenaBounds,
  worldColliders: readonly ArenaPropColliderRect[],
): WorldMoveResult {
  const canMoveTo = (nextX: number, nextY: number) =>
    canOccupyWorldPosition(nextX, nextY, footprint, bounds, worldColliders)

  if (canMoveTo(x + stepX, y + stepY)) {
    return {
      x: x + stepX,
      y: y + stepY,
      appliedDx: stepX,
      appliedDy: stepY,
      blockedX: false,
      blockedY: false,
    }
  }

  const tryXFirst = Math.abs(stepX) >= Math.abs(stepY)
  const first = tryXFirst ? { dx: stepX, dy: 0 } : { dx: 0, dy: stepY }
  const second = tryXFirst ? { dx: 0, dy: stepY } : { dx: stepX, dy: 0 }

  const candidates = [first, second]
  for (const candidate of candidates) {
    if (candidate.dx === 0 && candidate.dy === 0) continue
    if (canMoveTo(x + candidate.dx, y + candidate.dy)) {
      return {
        x: x + candidate.dx,
        y: y + candidate.dy,
        appliedDx: candidate.dx,
        appliedDy: candidate.dy,
        blockedX: stepX !== candidate.dx,
        blockedY: stepY !== candidate.dy,
      }
    }
  }

  return {
    x,
    y,
    appliedDx: 0,
    appliedDy: 0,
    blockedX: stepX !== 0,
    blockedY: stepY !== 0,
  }
}

/**
 * Clamps a footprint center against arena bounds (respecting radii) and pushes
 * it out of any overlapping world rectangles. Pure function — caller passes in
 * the resulting `(x, y)` to wherever it's stored (ECS Position, client
 * ClientPosition, etc.).
 *
 * @param x - Footprint center x in world pixels.
 * @param y - Footprint center y in world pixels.
 * @param footprint - Axis-aligned oval footprint radii in world pixels.
 * @param bounds - Arena bounds `{ width, height }`.
 * @param worldColliders - Static world rectangles.
 * @returns Resolved `{ x, y }` position after all clamps / MTVs are applied.
 */
export function resolveAgainstWorld(
  x: number,
  y: number,
  footprint: WorldCollisionFootprint,
  bounds: ArenaBounds,
  worldColliders: readonly ArenaPropColliderRect[],
): { x: number; y: number } {
  let cx = x
  let cy = y

  const minX = footprint.radiusX
  const minY = footprint.radiusY
  const maxX = bounds.width - footprint.radiusX
  const maxY = bounds.height - footprint.radiusY

  if (cx < minX) cx = minX
  if (cx > maxX) cx = maxX
  if (cy < minY) cy = minY
  if (cy > maxY) cy = maxY

  for (let pass = 0; pass < MAX_COLLISION_PASSES; pass++) {
    let moved = false
    for (const col of worldColliders) {
      const mtv = ellipseRectMTV(cx, cy, footprint, col)
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
