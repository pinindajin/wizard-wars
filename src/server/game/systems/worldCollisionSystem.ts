/**
 * worldCollisionSystem – clamps all player positions within the arena bounds
 * and resolves AABB collisions against static prop colliders.
 *
 * Players are treated as circles with radius PLAYER_RADIUS_PX.
 */
import { query } from "bitecs"

import { Position, PlayerTag } from "../components"
import type { SimCtx } from "../simulation"
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  PLAYER_RADIUS_PX,
  ARENA_PROP_COLLIDERS,
} from "../../../shared/balance-config"

const R = PLAYER_RADIUS_PX
const MIN_X = R
const MAX_X = ARENA_WIDTH - R
const MIN_Y = R
const MAX_Y = ARENA_HEIGHT - R

/**
 * Resolves overlap between a circle (cx, cy, r) and a rect (rx, ry, rw, rh).
 * Returns the minimum-translation-vector to push the circle outside the rect,
 * or null if there is no overlap.
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
  // Clamp circle centre to rect
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

export type ArenaPropColliderRect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Pushes one player circle out of static axis-aligned rectangles (shared with sim tests).
 *
 * @param eid - Player entity id with valid `Position`.
 * @param colliders - Footprint rectangles in world pixels.
 */
export function resolvePlayerAgainstPropColliders(
  eid: number,
  colliders: readonly ArenaPropColliderRect[],
): void {
  for (const col of colliders) {
    const mtv = circleRectMTV(
      Position.x[eid],
      Position.y[eid],
      R,
      col.x,
      col.y,
      col.width,
      col.height,
    )
    if (mtv) {
      Position.x[eid] += mtv.dx
      Position.y[eid] += mtv.dy
    }
  }
}

/**
 * Runs the world collision system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function worldCollisionSystem(ctx: SimCtx): void {
  const { world } = ctx

  for (const eid of query(world, [PlayerTag])) {
    // Arena boundary clamp
    if (Position.x[eid] < MIN_X) Position.x[eid] = MIN_X
    if (Position.x[eid] > MAX_X) Position.x[eid] = MAX_X
    if (Position.y[eid] < MIN_Y) Position.y[eid] = MIN_Y
    if (Position.y[eid] > MAX_Y) Position.y[eid] = MAX_Y

    resolvePlayerAgainstPropColliders(eid, ARENA_PROP_COLLIDERS)
  }
}
