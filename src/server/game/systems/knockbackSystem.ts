/**
 * knockbackSystem – applies pending Knockback impulses to entity positions.
 *
 * Each tick, the entity is pushed in the normalised impulse direction by the
 * remaining distance budget, reducing remainingPx toward zero.  When the
 * budget is exhausted the Knockback component is removed.
 */
import { query, hasComponent, removeComponent } from "bitecs"

import { Position, Knockback, PlayerTag, FireballTag } from "../components"
import type { SimCtx } from "../simulation"
import { TICK_DT_SEC } from "../../../shared/balance-config"

/** Pixels-per-second the knockback travels (budget drains at this rate). */
const KNOCKBACK_SPEED_PPS = 800

/**
 * Runs the knockback system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function knockbackSystem(ctx: SimCtx): void {
  const { world } = ctx

  const applyKnockback = (eid: number) => {
    if (!hasComponent(world, eid, Knockback)) return

    const ix = Knockback.impulseX[eid]
    const iy = Knockback.impulseY[eid]
    const remaining = Knockback.remainingPx[eid]

    if (remaining <= 0) {
      removeComponent(world, eid, Knockback)
      return
    }

    const len = Math.sqrt(ix * ix + iy * iy)
    if (len === 0) {
      removeComponent(world, eid, Knockback)
      return
    }

    const step = Math.min(remaining, KNOCKBACK_SPEED_PPS * TICK_DT_SEC)
    Position.x[eid] += (ix / len) * step
    Position.y[eid] += (iy / len) * step
    Knockback.remainingPx[eid] -= step

    if (Knockback.remainingPx[eid] <= 0) {
      removeComponent(world, eid, Knockback)
    }
  }

  for (const eid of query(world, [PlayerTag, Knockback])) {
    applyKnockback(eid)
  }
  for (const eid of query(world, [FireballTag, Knockback])) {
    applyKnockback(eid)
  }
}
