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

import {
  Position,
  Velocity,
  Facing,
  Health,
  Lives,
  Casting,
  PlayerTag,
  DeadTag,
  DyingTag,
  SpectatorTag,
  SwingingWeapon,
  InvulnerableTag,
  ABILITY_INDEX_TO_ID,
} from "../components"
import type { SimCtx, PlayerPrevState } from "../simulation"
import type { PlayerAnimState, PlayerDelta } from "../../../shared/types"

/** Derives the current animation state from an entity's component composition. */
function computeAnimState(
  world: import("bitecs").World,
  eid: number,
): PlayerAnimState {
  if (hasComponent(world, eid, DeadTag)) return "dead"
  if (hasComponent(world, eid, DyingTag)) return "dying"
  if (hasComponent(world, eid, SwingingWeapon)) return "axe_swing"

  if (hasComponent(world, eid, Casting)) {
    const abilityId = ABILITY_INDEX_TO_ID[Casting.abilityIndex[eid]] ?? ""
    if (abilityId === "lightning_bolt") return "heavy_cast"
    return "light_cast"
  }

  const vx = Velocity.vx[eid]
  const vy = Velocity.vy[eid]
  if (vx !== 0 || vy !== 0) return "walk"

  return "idle"
}

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
    const animState = computeAnimState(world, eid)
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
