/**
 * movementSystem – translates PlayerInput WASD into Velocity (px/s) and
 * advances Position each tick. Updates {@link Facing} toward the weapon cursor
 * (aim) and {@link MoveFacing} from the actual applied movement.
 *
 * Velocity semantics: `Velocity.vx/vy` store the actually-applied player
 * velocity in **pixels per second** (aligned with fireball velocity). The
 * requested WASD step is candidate-gated against world blockers before
 * Position is committed. This matches the client's rewind-and-replay math
 * and keeps snapshot `vx/vy` directly usable for remote extrapolation.
 *
 * Movement rules (in priority order):
 *  1. DyingTag / DeadTag / SpectatorTag → velocity = 0
 *  2. Casting → WASD speed × `castMoveSpeedMultiplier` (0 = root)
 *  3. SwingingWeapon                    → speed × SWING_MOVE_SPEED_MULTIPLIER
 *  4. Otherwise                         → speed × 1.0 (+ Swift Boots bonus)
 */
import { query, hasComponent } from "bitecs"

import {
  Position,
  Velocity,
  Facing,
  MoveFacing,
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
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
  PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
  SWING_MOVE_SPEED_MULTIPLIER,
  SWIFT_BOOTS_SPEED_BONUS,
  TICK_DT_SEC,
} from "../../../shared/balance-config"
import { ABILITY_CONFIGS } from "../../../shared/balance-config/abilities"
import { moveWithinWorld } from "../../../shared/collision/worldCollision"
import { normalizedMoveFromWASD } from "../../../shared/movementIntent"

const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
const PLAYER_WORLD_FOOTPRINT = {
  radiusX: PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  radiusY: PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
}

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
    const speedPxPerSec = BASE_MOVE_SPEED_PX_PER_SEC * speedMultiplier
    const stepX = dx * speedPxPerSec * TICK_DT_SEC
    const stepY = dy * speedPxPerSec * TICK_DT_SEC
    const moved = moveWithinWorld(
      Position.x[eid],
      Position.y[eid],
      stepX,
      stepY,
      PLAYER_WORLD_FOOTPRINT,
      ARENA_BOUNDS,
      ARENA_WORLD_COLLIDERS,
    )
    Velocity.vx[eid] = moved.appliedDx / TICK_DT_SEC
    Velocity.vy[eid] = moved.appliedDy / TICK_DT_SEC
    Position.x[eid] = moved.x
    Position.y[eid] = moved.y

    if (moved.appliedDx !== 0 || moved.appliedDy !== 0) {
      MoveFacing.angle[eid] = Math.atan2(moved.appliedDy, moved.appliedDx)
    }

    // Update aim facing toward weapon-target (mouse position)
    const wtx = PlayerInput.weaponTargetX[eid]
    const wty = PlayerInput.weaponTargetY[eid]
    const fdx = wtx - Position.x[eid]
    const fdy = wty - Position.y[eid]
    if (fdx !== 0 || fdy !== 0) {
      Facing.angle[eid] = Math.atan2(fdy, fdx)
    }
  }
}
