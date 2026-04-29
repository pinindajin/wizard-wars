import {
  CHARACTER_HITBOX_DOWN_PX,
  CHARACTER_HITBOX_LEFT_PX,
  CHARACTER_HITBOX_RIGHT_PX,
  CHARACTER_HITBOX_UP_PX,
} from "@/shared/balance-config/combat"

export type CharacterHitboxRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Builds the character combat hitbox for a player's authoritative sim anchor.
 *
 * @param x - Player sim anchor x in world pixels.
 * @param y - Player sim anchor y in world pixels.
 * @returns Axis-aligned combat hitbox rectangle in world pixels.
 */
export function characterHitboxForCenter(x: number, y: number): CharacterHitboxRect {
  return {
    x: x - CHARACTER_HITBOX_LEFT_PX,
    y: y - CHARACTER_HITBOX_UP_PX,
    width: CHARACTER_HITBOX_LEFT_PX + CHARACTER_HITBOX_RIGHT_PX,
    height: CHARACTER_HITBOX_UP_PX + CHARACTER_HITBOX_DOWN_PX,
  }
}

/**
 * Returns whether a point lies inside or on a rectangle.
 *
 * @param px - Point x in world pixels.
 * @param py - Point y in world pixels.
 * @param rect - Rectangle to test.
 * @returns Whether the point is inside the rectangle, counting edges.
 */
function pointInRect(px: number, py: number, rect: CharacterHitboxRect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height
}

/**
 * Returns the squared distance from a point to a rectangle.
 *
 * @param px - Point x in world pixels.
 * @param py - Point y in world pixels.
 * @param rect - Rectangle to measure against.
 * @returns Squared distance, or 0 when the point is inside the rectangle.
 */
function pointRectDistSq(px: number, py: number, rect: CharacterHitboxRect): number {
  const nearX = Math.max(rect.x, Math.min(px, rect.x + rect.width))
  const nearY = Math.max(rect.y, Math.min(py, rect.y + rect.height))
  const dx = px - nearX
  const dy = py - nearY
  return dx * dx + dy * dy
}

/**
 * Returns the squared distance from a point to a line segment.
 *
 * @param px - Point x in world pixels.
 * @param py - Point y in world pixels.
 * @param ax - Segment start x.
 * @param ay - Segment start y.
 * @param bx - Segment end x.
 * @param by - Segment end y.
 * @returns Squared distance from point to segment.
 */
function pointSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const ex = px - ax
    const ey = py - ay
    return ex * ex + ey * ey
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const closestX = ax + t * dx
  const closestY = ay + t * dy
  const fx = px - closestX
  const fy = py - closestY
  return fx * fx + fy * fy
}

/**
 * Returns the orientation of three ordered points.
 *
 * @param ax - First point x.
 * @param ay - First point y.
 * @param bx - Second point x.
 * @param by - Second point y.
 * @param cx - Third point x.
 * @param cy - Third point y.
 * @returns Signed orientation value.
 */
function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by)
}

/**
 * Returns whether a point lies on a line segment.
 *
 * @param px - Point x.
 * @param py - Point y.
 * @param ax - Segment start x.
 * @param ay - Segment start y.
 * @param bx - Segment end x.
 * @param by - Segment end y.
 * @returns Whether the point is on the segment.
 */
function pointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  return (
    px >= Math.min(ax, bx) &&
    px <= Math.max(ax, bx) &&
    py >= Math.min(ay, by) &&
    py <= Math.max(ay, by)
  )
}

/**
 * Returns whether two line segments intersect, counting touches.
 *
 * @param ax - First segment start x.
 * @param ay - First segment start y.
 * @param bx - First segment end x.
 * @param by - First segment end y.
 * @param cx - Second segment start x.
 * @param cy - Second segment start y.
 * @param dx - Second segment end x.
 * @param dy - Second segment end y.
 * @returns Whether the segments intersect.
 */
function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const o1 = orientation(ax, ay, bx, by, cx, cy)
  const o2 = orientation(ax, ay, bx, by, dx, dy)
  const o3 = orientation(cx, cy, dx, dy, ax, ay)
  const o4 = orientation(cx, cy, dx, dy, bx, by)

  if (o1 === 0 && pointOnSegment(cx, cy, ax, ay, bx, by)) return true
  if (o2 === 0 && pointOnSegment(dx, dy, ax, ay, bx, by)) return true
  if (o3 === 0 && pointOnSegment(ax, ay, cx, cy, dx, dy)) return true
  if (o4 === 0 && pointOnSegment(bx, by, cx, cy, dx, dy)) return true

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)
}

/**
 * Returns the four corners of a rectangle.
 *
 * @param rect - Rectangle to expand.
 * @returns Rectangle corners in clockwise order.
 */
function rectCorners(rect: CharacterHitboxRect): readonly { x: number; y: number }[] {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  return [
    { x: rect.x, y: rect.y },
    { x: right, y: rect.y },
    { x: right, y: bottom },
    { x: rect.x, y: bottom },
  ]
}

/**
 * Returns the four edges of a rectangle.
 *
 * @param rect - Rectangle to expand.
 * @returns Rectangle edges as line segments.
 */
function rectEdges(rect: CharacterHitboxRect): readonly [number, number, number, number][] {
  const corners = rectCorners(rect)
  return [
    [corners[0]!.x, corners[0]!.y, corners[1]!.x, corners[1]!.y],
    [corners[1]!.x, corners[1]!.y, corners[2]!.x, corners[2]!.y],
    [corners[2]!.x, corners[2]!.y, corners[3]!.x, corners[3]!.y],
    [corners[3]!.x, corners[3]!.y, corners[0]!.x, corners[0]!.y],
  ]
}

/**
 * Tests whether a point angle lies inside a cone arc.
 *
 * @param ox - Cone origin x.
 * @param oy - Cone origin y.
 * @param facingAngle - Cone center angle in radians.
 * @param px - Point x.
 * @param py - Point y.
 * @param halfArcRad - Half cone arc in radians.
 * @returns Whether the point angle is within the arc.
 */
function pointAngleInArc(
  ox: number,
  oy: number,
  facingAngle: number,
  px: number,
  py: number,
  halfArcRad: number,
): boolean {
  const angle = Math.atan2(py - oy, px - ox)
  const diff = normalizeAngleDiff(angle - facingAngle)
  return Math.abs(diff) <= halfArcRad
}

/**
 * Tests whether a rectangle edge crosses the curved outer arc of a swing cone.
 *
 * @param ax - Edge start x.
 * @param ay - Edge start y.
 * @param bx - Edge end x.
 * @param by - Edge end y.
 * @param ox - Cone origin x.
 * @param oy - Cone origin y.
 * @param facingAngle - Cone center angle in radians.
 * @param radiusPx - Cone radius in pixels.
 * @param halfArcRad - Half cone arc in radians.
 * @returns Whether the edge intersects the cone's circular arc.
 */
function segmentIntersectsSwingArc(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ox: number,
  oy: number,
  facingAngle: number,
  radiusPx: number,
  halfArcRad: number,
): boolean {
  const sx = ax - ox
  const sy = ay - oy
  const dx = bx - ax
  const dy = by - ay
  const a = dx * dx + dy * dy
  const b = 2 * (sx * dx + sy * dy)
  const c = sx * sx + sy * sy - radiusPx * radiusPx
  const discriminant = b * b - 4 * a * c
  if (a === 0 || discriminant < 0) return false

  const sqrt = Math.sqrt(discriminant)
  const t1 = (-b - sqrt) / (2 * a)
  const t2 = (-b + sqrt) / (2 * a)
  for (const t of [t1, t2]) {
    if (t < 0 || t > 1) continue
    const px = ax + dx * t
    const py = ay + dy * t
    if (pointAngleInArc(ox, oy, facingAngle, px, py, halfArcRad)) return true
  }

  return false
}

/**
 * Tests whether a circle intersects a rectangle, counting edge touches.
 *
 * @param cx - Circle center x.
 * @param cy - Circle center y.
 * @param radius - Circle radius in pixels.
 * @param rect - Rectangle to test.
 * @returns Whether the circle intersects the rectangle.
 */
export function circleIntersectsRect(
  cx: number,
  cy: number,
  radius: number,
  rect: CharacterHitboxRect,
): boolean {
  return pointRectDistSq(cx, cy, rect) <= radius * radius
}

/**
 * Tests whether a capsule intersects a rectangle, counting edge touches.
 *
 * @param ax - Capsule segment start x.
 * @param ay - Capsule segment start y.
 * @param bx - Capsule segment end x.
 * @param by - Capsule segment end y.
 * @param radius - Capsule radius in pixels.
 * @param rect - Rectangle to test.
 * @returns Whether the capsule intersects the rectangle.
 */
export function capsuleIntersectsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  rect: CharacterHitboxRect,
): boolean {
  if (pointInRect(ax, ay, rect) || pointInRect(bx, by, rect)) return true

  for (const [ex1, ey1, ex2, ey2] of rectEdges(rect)) {
    if (segmentsIntersect(ax, ay, bx, by, ex1, ey1, ex2, ey2)) return true
  }

  const radiusSq = radius * radius
  if (pointRectDistSq(ax, ay, rect) <= radiusSq) return true
  if (pointRectDistSq(bx, by, rect) <= radiusSq) return true

  for (const corner of rectCorners(rect)) {
    if (pointSegmentDistSq(corner.x, corner.y, ax, ay, bx, by) <= radiusSq) return true
  }

  return false
}

/**
 * Normalizes `angleA - angleB` to (-π, π].
 *
 * @param diff - Raw angle difference in radians.
 * @returns Normalized angle difference in radians.
 */
export function normalizeAngleDiff(diff: number): number {
  let d = diff
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

/**
 * Tests whether a point lies inside a swing cone.
 *
 * @param ox - Cone origin x.
 * @param oy - Cone origin y.
 * @param facingAngle - Cone center angle in radians.
 * @param px - Point x.
 * @param py - Point y.
 * @param radiusPx - Cone radius in pixels.
 * @param arcDeg - Full cone arc in degrees.
 * @returns Whether the point is inside the cone, counting edges.
 */
export function pointInSwingCone(
  ox: number,
  oy: number,
  facingAngle: number,
  px: number,
  py: number,
  radiusPx: number,
  arcDeg: number,
): boolean {
  const halfArcRad = ((arcDeg / 2) * Math.PI) / 180
  const dx = px - ox
  const dy = py - oy
  const distSq = dx * dx + dy * dy
  if (distSq > radiusPx * radiusPx) return false
  const angle = Math.atan2(dy, dx)
  const diff = normalizeAngleDiff(angle - facingAngle)
  return Math.abs(diff) <= halfArcRad
}

/**
 * Tests whether a swing cone intersects a rectangle.
 *
 * @param ox - Cone origin x.
 * @param oy - Cone origin y.
 * @param facingAngle - Cone center angle in radians.
 * @param radiusPx - Cone radius in pixels.
 * @param arcDeg - Full cone arc in degrees.
 * @param rect - Rectangle to test.
 * @returns Whether the cone intersects the rectangle, counting edge touches.
 */
export function swingConeIntersectsRect(
  ox: number,
  oy: number,
  facingAngle: number,
  radiusPx: number,
  arcDeg: number,
  rect: CharacterHitboxRect,
): boolean {
  if (pointInRect(ox, oy, rect)) return true
  for (const corner of rectCorners(rect)) {
    if (pointInSwingCone(ox, oy, facingAngle, corner.x, corner.y, radiusPx, arcDeg)) return true
  }

  const halfArcRad = ((arcDeg / 2) * Math.PI) / 180
  const leftAngle = facingAngle - halfArcRad
  const rightAngle = facingAngle + halfArcRad
  const boundaryA = { x: ox + Math.cos(leftAngle) * radiusPx, y: oy + Math.sin(leftAngle) * radiusPx }
  const boundaryB = { x: ox + Math.cos(rightAngle) * radiusPx, y: oy + Math.sin(rightAngle) * radiusPx }

  for (const [ex1, ey1, ex2, ey2] of rectEdges(rect)) {
    if (segmentsIntersect(ox, oy, boundaryA.x, boundaryA.y, ex1, ey1, ex2, ey2)) return true
    if (segmentsIntersect(ox, oy, boundaryB.x, boundaryB.y, ex1, ey1, ex2, ey2)) return true
    if (segmentIntersectsSwingArc(ex1, ey1, ex2, ey2, ox, oy, facingAngle, radiusPx, halfArcRad)) {
      return true
    }
  }

  const centerAngle = facingAngle
  const centerEnd = { x: ox + Math.cos(centerAngle) * radiusPx, y: oy + Math.sin(centerAngle) * radiusPx }
  if (capsuleIntersectsRect(ox, oy, centerEnd.x, centerEnd.y, 0, rect)) return true

  return false
}
