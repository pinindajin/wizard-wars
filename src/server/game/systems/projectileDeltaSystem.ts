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

import { FireballTag, HomingOrb, HomingOrbTag, Position, Velocity } from "../components"
import type { HomingOrbDelta, HomingOrbPrevState, SimCtx } from "../simulation"

type MutableHomingOrbDelta = {
  -readonly [Key in keyof HomingOrbDelta]: HomingOrbDelta[Key]
}

/**
 * Seeds or appends a Homing Orb delta when its movement state changes.
 *
 * @param ctx - Simulation context.
 * @param eid - Homing Orb entity id.
 * @param prev - Previous state map entry, if any.
 */
function collectHomingOrbDelta(
  ctx: SimCtx,
  eid: number,
  prev: HomingOrbPrevState | undefined,
): void {
  const x = Position.x[eid]
  const y = Position.y[eid]
  const vx = Velocity.vx[eid]
  const vy = Velocity.vy[eid]
  const headingRad = HomingOrb.headingRad[eid]
  const targetId = ctx.homingOrbTargetPlayerMap.get(eid)

  if (!prev) {
    const next: HomingOrbPrevState = {
      x,
      y,
      vx,
      vy,
      headingRad,
    }
    if (targetId !== undefined) {
      next.targetId = targetId
    }
    ctx.prevHomingOrbStates.set(eid, next)
    return
  }

  const delta: MutableHomingOrbDelta = { id: eid }
  let changed = false
  if (x !== prev.x) {
    delta.x = x
    changed = true
  }
  if (y !== prev.y) {
    delta.y = y
    changed = true
  }
  if (vx !== prev.vx) {
    delta.vx = vx
    changed = true
  }
  if (vy !== prev.vy) {
    delta.vy = vy
    changed = true
  }
  if (headingRad !== prev.headingRad) {
    delta.headingRad = headingRad
    changed = true
  }
  if (targetId !== prev.targetId) {
    delta.targetId = targetId ?? null
    changed = true
  }

  if (changed) {
    ctx.homingOrbDeltas.push(delta)
    prev.x = x
    prev.y = y
    prev.vx = vx
    prev.vy = vy
    prev.headingRad = headingRad
    if (targetId !== undefined) {
      prev.targetId = targetId
    } else {
      delete prev.targetId
    }
  }
}

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

  for (const eid of query(world, [HomingOrbTag])) {
    collectHomingOrbDelta(ctx, eid, ctx.prevHomingOrbStates.get(eid))
  }
}
