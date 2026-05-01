/**
 * jumpPhysicsSystem — integrates vertical jump height each tick after horizontal motion,
 * resolves landing against walkability (pit deaths), and clears `JumpArc` when grounded.
 */
import { query, hasComponent, removeComponent } from "bitecs"

import {
  JumpArc,
  PlayerTag,
  Position,
  Velocity,
  Health,
  DyingTag,
  DeadTag,
  SpectatorTag,
  InvulnerableTag,
} from "../components"
import type { SimCtx } from "../simulation"
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  JUMP_GRAVITY_PX_PER_SEC2,
  JUMP_LANDING_GRACE_PX,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
  TICK_DT_SEC,
} from "../../../shared/balance-config"
import {
  resolveJumpLandingWithGrace,
} from "../../../shared/collision/worldCollision"
import { ARENA_WORLD_COLLIDERS } from "../../../shared/balance-config/arena"

const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

/**
 * Runs jump vertical integration and landing resolution for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function jumpPhysicsSystem(ctx: SimCtx): void {
  const { world, damageRequests } = ctx

  for (const eid of query(world, [PlayerTag, JumpArc])) {
    if (
      hasComponent(world, eid, DyingTag) ||
      hasComponent(world, eid, DeadTag) ||
      hasComponent(world, eid, SpectatorTag)
    ) {
      removeComponent(world, eid, JumpArc)
      JumpArc.z[eid] = 0
      JumpArc.vz[eid] = 0
      continue
    }

    let vz = JumpArc.vz[eid]
    let z = JumpArc.z[eid]

    vz -= JUMP_GRAVITY_PX_PER_SEC2 * TICK_DT_SEC
    z += vz * TICK_DT_SEC

    if (z > 0) {
      JumpArc.vz[eid] = vz
      JumpArc.z[eid] = z
      continue
    }

    // Landed this tick
    JumpArc.z[eid] = 0
    JumpArc.vz[eid] = 0
    removeComponent(world, eid, JumpArc)

    const gx = Position.x[eid]
    const gy = Position.y[eid]
    const landing = resolveJumpLandingWithGrace(
      gx,
      gy,
      PLAYER_WORLD_COLLISION_FOOTPRINT,
      ARENA_BOUNDS,
      ARENA_WORLD_COLLIDERS,
      {
        movementX: Velocity.vx[eid],
        movementY: Velocity.vy[eid],
        gracePx: JUMP_LANDING_GRACE_PX,
      },
    )
    if (landing) {
      Position.x[eid] = landing.x
      Position.y[eid] = landing.y
      continue
    }

    if (hasComponent(world, eid, InvulnerableTag)) continue

    const hp = Health.current[eid]
    if (hp <= 0) continue

    damageRequests.push({
      targetEid: eid,
      damage: hp,
      killerUserId: null,
      killerAbilityId: "pit",
    })
  }
}
