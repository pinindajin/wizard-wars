/**
 * playerDeltaSystem – computes per-player state deltas for the current tick.
 *
 * Only fields that have changed since the previous tick are included in the
 * delta.  prevPlayerStates is updated in-place for the next tick.
 *
 * animState is derived from the entity's current component composition:
 *   dead       → "dead"
 *   dying      → "dying"
 *   axe swing  → "axe_swing"
 *   casting    → "light_cast" (fireball) | "heavy_cast" (lightning)
 *   moving     → "walk"
 *   otherwise  → "idle"
 */
import { query, hasComponent } from "bitecs"

import { Position, Velocity, Facing, Health, Lives, PlayerTag, InvulnerableTag } from "../components"
import { computePlayerAnimState } from "../playerAnimState"
import type { SimCtx, PlayerPrevState } from "../simulation"
import type { PlayerDelta } from "../../../shared/types"

/**
 * Runs the player delta system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function playerDeltaSystem(ctx: SimCtx): void {
  const { world, prevPlayerStates } = ctx

  for (const eid of query(world, [PlayerTag])) {
    const prev = prevPlayerStates.get(eid)
    const x = Position.x[eid]
    const y = Position.y[eid]
    const facingAngle = Facing.angle[eid]
    const health = Health.current[eid]
    const lives = Lives.count[eid]
    const animState = computePlayerAnimState(world, eid)
    const invulnerable = hasComponent(world, eid, InvulnerableTag)

    if (!prev) {
      ctx.playerDeltas.push({ id: eid, x, y, facingAngle, health, lives, animState, invulnerable })
      prevPlayerStates.set(eid, { x, y, facingAngle, health, lives, animState, invulnerable })
      continue
    }

    // Build delta using spread so we never mutate readonly PlayerDelta fields
    const delta: PlayerDelta = {
      id: eid,
      ...(x !== prev.x ? { x } : {}),
      ...(y !== prev.y ? { y } : {}),
      ...(facingAngle !== prev.facingAngle ? { facingAngle } : {}),
      ...(health !== prev.health ? { health } : {}),
      ...(lives !== prev.lives ? { lives } : {}),
      ...(animState !== prev.animState ? { animState } : {}),
      ...(invulnerable !== prev.invulnerable ? { invulnerable } : {}),
    }

    const changed =
      delta.x !== undefined ||
      delta.y !== undefined ||
      delta.facingAngle !== undefined ||
      delta.health !== undefined ||
      delta.lives !== undefined ||
      delta.animState !== undefined ||
      delta.invulnerable !== undefined

    if (changed) {
      ctx.playerDeltas.push(delta)
      prev.x = x
      prev.y = y
      prev.facingAngle = facingAngle
      prev.health = health
      prev.lives = lives
      prev.animState = animState
      prev.invulnerable = invulnerable
    }
  }
}
