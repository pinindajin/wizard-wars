/**
 * projectileDeltaSystem – computes per-fireball position deltas for the
 * current tick.
 *
 * Newly-created fireballs (not in prevFireballStates) are skipped here because
 * their initial position is already conveyed via the FireballLaunchPayload
 * emitted by castingSystem.  Their state is seeded into prevFireballStates so
 * that next-tick deltas are computed correctly.
 */
import { query } from "bitecs"

import { Position, FireballTag } from "../components"
import type { SimCtx, FireballPrevState } from "../simulation"

/**
 * Runs the projectile delta system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function projectileDeltaSystem(ctx: SimCtx): void {
  const { world, prevFireballStates, fireballDeltas } = ctx

  for (const eid of query(world, [FireballTag])) {
    const x = Position.x[eid]
    const y = Position.y[eid]

    const prev = prevFireballStates.get(eid)
    if (!prev) {
      // Brand-new fireball: seed prev state, skip the delta (launch payload covers it)
      prevFireballStates.set(eid, { x, y })
      continue
    }

    if (x !== prev.x || y !== prev.y) {
      fireballDeltas.push({ id: eid, x, y })
      prev.x = x
      prev.y = y
    }
  }

  // Clean up prev states for removed fireballs (those not in current query)
  const alive = new Set<number>()
  for (const eid of query(world, [FireballTag])) alive.add(eid)
  for (const eid of prevFireballStates.keys()) {
    if (!alive.has(eid)) {
      prevFireballStates.delete(eid)
    }
  }
}
