/**
 * movementSystem – translates PlayerInput WASD into Velocity and updates
 * Position and Facing each tick.
 *
 * Movement rules (in priority order):
 *  1. DyingTag / DeadTag / SpectatorTag → velocity = 0
 *  2. Casting component with quick=0    → velocity = 0
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
} from "../components"
import type { SimCtx } from "../simulation"
import {
  BASE_MOVE_SPEED_PX_PER_SEC,
  SWING_MOVE_SPEED_MULTIPLIER,
  SWIFT_BOOTS_SPEED_BONUS,
  TICK_DT_SEC,
} from "../../../shared/balance-config"

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

    // Casting a non-quick ability locks movement
    if (hasComponent(world, eid, Casting) && Casting.quick[eid] === 0) {
      Velocity.vx[eid] = 0
      Velocity.vy[eid] = 0
      continue
    }

    // Speed multiplier
    let speedMultiplier = 1.0
    if (hasComponent(world, eid, SwingingWeapon)) {
      speedMultiplier = SWING_MOVE_SPEED_MULTIPLIER
    } else if (Equipment.hasSwiftBoots[eid] === 1) {
      speedMultiplier = 1.0 + SWIFT_BOOTS_SPEED_BONUS
    }

    const up = PlayerInput.up[eid]
    const down = PlayerInput.down[eid]
    const left = PlayerInput.left[eid]
    const right = PlayerInput.right[eid]

    let dx = 0
    let dy = 0
    if (right) dx += 1
    if (left) dx -= 1
    if (down) dy += 1
    if (up) dy -= 1

    // Normalize diagonal movement
    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy)
      dx /= len
      dy /= len
    }

    const speed = BASE_MOVE_SPEED_PX_PER_SEC * speedMultiplier * TICK_DT_SEC
    Velocity.vx[eid] = dx * speed
    Velocity.vy[eid] = dy * speed
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
