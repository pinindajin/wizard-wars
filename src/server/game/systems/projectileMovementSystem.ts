/**
 * projectileMovementSystem – advances all fireball projectiles by their
 * velocity each tick and despawns any that have travelled too far past the
 * arena boundary.
 *
 * Despawn condition: the fireball centre is more than FIREBALL_DESPAWN_OVERSHOOT_PX
 * pixels outside any arena edge.
 */
import { query } from "bitecs"

import { Position, Velocity, FireballTag } from "../components"
import type { SimCtx } from "../simulation"
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  FIREBALL_DESPAWN_OVERSHOOT_PX,
  TICK_DT_SEC,
} from "../../../shared/balance-config"

const OVER = FIREBALL_DESPAWN_OVERSHOOT_PX

/**
 * Runs the projectile movement system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function projectileMovementSystem(ctx: SimCtx): void {
  const {
    world,
    commandBuffer,
    fireballOwnerMap,
    fireballCreatedAtTickMap,
    fireballRemovedIds,
  } = ctx

  for (const eid of query(world, [FireballTag])) {
    // Advance position
    Position.x[eid] += Velocity.vx[eid] * TICK_DT_SEC
    Position.y[eid] += Velocity.vy[eid] * TICK_DT_SEC

    const x = Position.x[eid]
    const y = Position.y[eid]

    const outOfBounds =
      x < -OVER || x > ARENA_WIDTH + OVER ||
      y < -OVER || y > ARENA_HEIGHT + OVER

    if (outOfBounds) {
      fireballRemovedIds.push(eid)
      fireballOwnerMap.delete(eid)
      fireballCreatedAtTickMap.delete(eid)
      commandBuffer.enqueue({ type: "removeEntity", eid })
    }
  }
}
