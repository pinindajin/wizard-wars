/**
 * worldCollisionSystem – clamps all player positions within the arena bounds
 * and resolves AABB collisions against static world colliders.
 *
 * Delegates to the shared `resolveAgainstWorld` math so the client's
 * rewind-and-replay path can run identical collision resolution.
 */
import { query } from "bitecs"

import { Position, PlayerTag } from "../components"
import type { SimCtx } from "../simulation"
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
  ARENA_WORLD_COLLIDERS,
} from "../../../shared/balance-config"
import {
  resolveAgainstWorld,
  type ArenaPropColliderRect,
} from "../../../shared/collision/worldCollision"

export type { ArenaPropColliderRect } from "../../../shared/collision/worldCollision"

const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
const PLAYER_WORLD_FOOTPRINT = {
  radiusX: PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  radiusY: PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
}

/**
 * Pushes one player oval out of static axis-aligned rectangles and clamps
 * it against the arena bounds (shared with sim tests + client replay).
 *
 * @param eid - Player entity id with valid `Position`.
 * @param colliders - Footprint rectangles in world pixels.
 */
export function resolvePlayerAgainstPropColliders(
  eid: number,
  colliders: readonly ArenaPropColliderRect[],
): void {
  const out = resolveAgainstWorld(
    Position.x[eid],
    Position.y[eid],
    PLAYER_WORLD_FOOTPRINT,
    ARENA_BOUNDS,
    colliders,
  )
  Position.x[eid] = out.x
  Position.y[eid] = out.y
}

/**
 * Runs the world collision system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function worldCollisionSystem(ctx: SimCtx): void {
  const { world } = ctx

  for (const eid of query(world, [PlayerTag])) {
    const out = resolveAgainstWorld(
      Position.x[eid],
      Position.y[eid],
      PLAYER_WORLD_FOOTPRINT,
      ARENA_BOUNDS,
      ARENA_WORLD_COLLIDERS,
    )
    Position.x[eid] = out.x
    Position.y[eid] = out.y
  }
}
