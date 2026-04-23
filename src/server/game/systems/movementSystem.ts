/**
 * movementSystem – translates PlayerInput WASD into Velocity and updates
 * Position and Facing each tick.
 *
 * Movement rules (in priority order):
 *  1. DyingTag / DeadTag / SpectatorTag → velocity = 0
 *  2. Casting → WASD step × `castMoveSpeedMultiplier` (0 = root)
 *  3. SwingingWeapon                    → speed × SWING_MOVE_SPEED_MULTIPLIER
 *  4. Otherwise                         → speed × 1.0 (+ Swift Boots bonus)
 *
 * Facing angle is updated to point toward the weapon-target cursor position.
 */
import { query, hasComponent } from "bitecs"

import {
  Position,
  Velocity,
  Facing,
  Equipment,
  PlayerInput,
  Casting,
  DyingTag,
  DeadTag,
  SpectatorTag,
  SwingingWeapon,
  PlayerTag,
  ABILITY_INDEX_TO_ID,
} from "../components"
import type { SimCtx } from "../simulation"
import {
  BASE_MOVE_SPEED_PX_PER_SEC,
  SWING_MOVE_SPEED_MULTIPLIER,
  SWIFT_BOOTS_SPEED_BONUS,
  TICK_DT_SEC,
} from "../../../shared/balance-config"
import { ABILITY_CONFIGS } from "../../../shared/balance-config/abilities"
import { normalizedMoveFromWASD, worldStepFromIntent } from "../../../shared/movementIntent"

/**
 * Runs the movement system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function movementSystem(ctx: SimCtx): void {
  const { world } = ctx

  for (const eid of query(world, [PlayerTag])) {
    // Blocked from moving
    if (
      hasComponent(world, eid, DyingTag) ||
      hasComponent(world, eid, DeadTag) ||
      hasComponent(world, eid, SpectatorTag)
    ) {
      Velocity.vx[eid] = 0
      Velocity.vy[eid] = 0
      Position.x[eid] += 0
      Position.y[eid] += 0
      continue
    }

    // Speed multiplier
    let speedMultiplier = 1.0
    if (hasComponent(world, eid, SwingingWeapon)) {
      speedMultiplier = SWING_MOVE_SPEED_MULTIPLIER
    } else if (Equipment.hasSwiftBoots[eid] === 1) {
      speedMultiplier = 1.0 + SWIFT_BOOTS_SPEED_BONUS
    }

    // When casting, scale movement by per-ability castMoveSpeedMultiplier (0 = root)
    if (hasComponent(world, eid, Casting)) {
      const abilityId = ABILITY_INDEX_TO_ID[Casting.abilityIndex[eid]] ?? ""
      const cfg = abilityId ? ABILITY_CONFIGS[abilityId] : undefined
      const castMoveMult = cfg?.castMoveSpeedMultiplier ?? 0
      if (castMoveMult === 0) {
        Velocity.vx[eid] = 0
        Velocity.vy[eid] = 0
        continue
      }
      speedMultiplier *= castMoveMult
    }

    const up = PlayerInput.up[eid]
    const down = PlayerInput.down[eid]
    const left = PlayerInput.left[eid]
    const right = PlayerInput.right[eid]

    const { dx, dy } = normalizedMoveFromWASD({
      up: up === 1,
      down: down === 1,
      left: left === 1,
      right: right === 1,
    })
    const step = worldStepFromIntent(dx, dy, BASE_MOVE_SPEED_PX_PER_SEC, TICK_DT_SEC, speedMultiplier)
    Velocity.vx[eid] = step.x
    Velocity.vy[eid] = step.y
    Position.x[eid] += Velocity.vx[eid]
    Position.y[eid] += Velocity.vy[eid]

    // Update facing toward weapon-target (mouse position)
    const wtx = PlayerInput.weaponTargetX[eid]
    const wty = PlayerInput.weaponTargetY[eid]
    const fdx = wtx - Position.x[eid]
    const fdy = wty - Position.y[eid]
    if (fdx !== 0 || fdy !== 0) {
      Facing.angle[eid] = Math.atan2(fdy, fdx)
    }
  }
}
