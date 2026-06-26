/**
 * projectileMovementSystem – advances all fireball projectiles by their
 * velocity each tick and despawns any that have travelled too far past the
 * arena boundary.
 *
 * Despawn condition: the fireball centre is more than FIREBALL_DESPAWN_OVERSHOOT_PX
 * pixels outside any arena edge.
 */
import { query } from "bitecs"

import {
  FireballTag,
  HomingOrb,
  HomingOrbTag,
  Ownership,
  Position,
  Velocity,
} from "../components"
import type { DamageRequest, SimCtx } from "../simulation"
import { getHomingOrbDamageableTargets } from "../damageablePlayerCache"
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  FIREBALL_DESPAWN_OVERSHOOT_PX,
  HOMING_ORB_ACCEL_CONE_DEG,
  HOMING_ORB_ACCEL_PX_PER_SEC2,
  HOMING_ORB_EXPIRY_DAMAGE,
  HOMING_ORB_HIT_RADIUS_PX,
  HOMING_ORB_MAX_SPEED_PX_PER_SEC,
  HOMING_ORB_MIN_SPEED_PX_PER_SEC,
  HOMING_ORB_TURN_DECEL_PX_PER_SEC2,
  HOMING_ORB_TURN_RATE_DEG_PER_SEC,
  TICK_DT_SEC,
} from "../../../shared/balance-config"
import {
  circleIntersectsRect,
} from "../../../shared/collision/characterHitbox"
import { removeFireballProjectile } from "../projectileCleanup"

const OVER = FIREBALL_DESPAWN_OVERSHOOT_PX
const TURN_RATE_RAD_PER_SEC = HOMING_ORB_TURN_RATE_DEG_PER_SEC * Math.PI / 180
const ACCEL_CONE_RAD = HOMING_ORB_ACCEL_CONE_DEG * Math.PI / 180

/**
 * Normalizes an angle to the `[-PI, PI]` range.
 *
 * @param angle - Angle in radians.
 * @returns Equivalent normalized angle.
 */
function normalizeAngleRad(angle: number): number {
  let a = angle
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

/**
 * Clamps a numeric value to an inclusive range.
 *
 * @param value - Input value.
 * @param min - Minimum allowed value.
 * @param max - Maximum allowed value.
 * @returns Clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Removes a Homing Orb from all cross-tick maps and queues entity removal.
 *
 * @param ctx - Simulation context.
 * @param orbEid - Homing Orb entity id.
 */
function removeHomingOrb(ctx: SimCtx, orbEid: number): void {
  ctx.homingOrbRemovedIds.push(orbEid)
  ctx.homingOrbOwnerMap.delete(orbEid)
  ctx.homingOrbTargetPlayerMap.delete(orbEid)
  ctx.prevHomingOrbStates.delete(orbEid)
  ctx.commandBuffer.enqueue({ type: "removeEntity", eid: orbEid })
}

/**
 * Returns true when a player can be targeted or damaged by a Homing Orb.
 *
 * @param ctx - Simulation context.
 * @param ownerEid - Projectile owner entity id.
 * @param targetEid - Candidate target entity id.
 * @param expectedUserId - Optional stored user id for stale entity-id protection.
 * @param ownerUserId - Optional stored owner user id for stale entity-id protection.
 * @returns True when the entity is a live, vulnerable enemy and matches the expected user.
 */
function isValidHomingTarget(
  ctx: SimCtx,
  ownerEid: number,
  targetEid: number,
  expectedUserId?: string,
  ownerUserId?: string,
): boolean {
  if (targetEid === ownerEid) return false
  const target = getHomingOrbDamageableTargets(ctx).find((candidate) => candidate.eid === targetEid)
  if (!target) return false
  const userId = target.userId
  if (ownerUserId !== undefined && userId === ownerUserId) return false
  return expectedUserId === undefined || userId === expectedUserId
}

/**
 * Finds the valid Homing Orb target nearest a world position in one pass.
 *
 * @param ctx - Simulation context.
 * @param ownerEid - Projectile owner entity id.
 * @param ownerUserId - Optional stored owner user id.
 * @param x - World x coordinate to search around.
 * @param y - World y coordinate to search around.
 * @returns Closest valid target entity/user id pair, or null when none exists.
 */
function nearestHomingTarget(
  ctx: SimCtx,
  ownerEid: number,
  ownerUserId: string | undefined,
  x: number,
  y: number,
): { readonly eid: number; readonly userId: string } | null {
  let best: { eid: number; userId: string; distSq: number } | null = null
  for (const candidate of getHomingOrbDamageableTargets(ctx)) {
    if (candidate.eid === ownerEid) continue
    if (ownerUserId !== undefined && candidate.userId === ownerUserId) continue
    const dx = candidate.x - x
    const dy = candidate.y - y
    const distSq = dx * dx + dy * dy
    if (best === null || distSq < best.distSq) {
      best = { eid: candidate.eid, userId: candidate.userId, distSq }
    }
  }
  return best === null ? null : { eid: best.eid, userId: best.userId }
}

/**
 * Applies Homing Orb expiry damage to all valid enemy hitboxes intersecting its radius.
 *
 * @param ctx - Simulation context.
 * @param orbEid - Expiring Homing Orb entity id.
 * @param ownerEid - Projectile owner entity id.
 * @returns User ids hit by the expiry explosion.
 */
function applyHomingOrbExpiryDamage(
  ctx: SimCtx,
  orbEid: number,
  ownerEid: number,
): string[] {
  const hitPlayerIds: string[] = []
  const ownerUserId = ctx.homingOrbOwnerMap.get(orbEid) ?? null
  const orbX = Position.x[orbEid]
  const orbY = Position.y[orbEid]

  for (const target of getHomingOrbDamageableTargets(ctx)) {
    if (target.eid === ownerEid) continue
    if (ownerUserId !== null && target.userId === ownerUserId) continue
    if (!circleIntersectsRect(orbX, orbY, HOMING_ORB_HIT_RADIUS_PX, target.hitbox)) continue
    const req: DamageRequest = {
      targetEid: target.eid,
      damage: HOMING_ORB_EXPIRY_DAMAGE,
      killerUserId: ownerUserId,
      killerAbilityId: "homing_orb",
    }
    ctx.damageRequests.push(req)
    hitPlayerIds.push(target.userId)
  }

  return hitPlayerIds
}

/**
 * Runs the projectile movement system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function projectileMovementSystem(ctx: SimCtx): void {
  const {
    world,
    currentTick,
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
      removeFireballProjectile(ctx, eid)
    }
  }

  for (const eid of query(world, [HomingOrbTag])) {
    if (ctx.homingOrbRemovedIds.includes(eid)) continue

    const ownerEid = Ownership.ownerEid[eid]
    const ownerUserId = ctx.homingOrbOwnerMap.get(eid)
    const x = Position.x[eid]
    const y = Position.y[eid]

    if (currentTick >= HomingOrb.expiresAtTick[eid]) {
      const hitPlayerIds = applyHomingOrbExpiryDamage(ctx, eid, ownerEid)
      ctx.homingOrbImpacts.push({
        id: eid,
        x,
        y,
        reason: "expired",
        hitPlayerIds,
        damage: HOMING_ORB_EXPIRY_DAMAGE,
      })
      removeHomingOrb(ctx, eid)
      continue
    }

    const storedTargetEid = HomingOrb.targetEid[eid]
    const storedTargetUserId = ctx.homingOrbTargetPlayerMap.get(eid)
    let targetEid =
      storedTargetEid >= 0 &&
      storedTargetUserId !== undefined &&
      isValidHomingTarget(ctx, ownerEid, storedTargetEid, storedTargetUserId, ownerUserId)
        ? storedTargetEid
        : -1

    if (targetEid < 0) {
      const next = nearestHomingTarget(ctx, ownerEid, ownerUserId, x, y)
      if (next) {
        targetEid = next.eid
        HomingOrb.targetEid[eid] = next.eid
        ctx.homingOrbTargetPlayerMap.set(eid, next.userId)
      } else {
        HomingOrb.targetEid[eid] = -1
        ctx.homingOrbTargetPlayerMap.delete(eid)
      }
    }

    let heading = HomingOrb.headingRad[eid]
    let shouldAccelerate = false
    if (targetEid >= 0) {
      const desired = Math.atan2(Position.y[targetEid] - y, Position.x[targetEid] - x)
      const delta = normalizeAngleRad(desired - heading)
      const maxTurn = TURN_RATE_RAD_PER_SEC * TICK_DT_SEC
      heading = normalizeAngleRad(heading + clamp(delta, -maxTurn, maxTurn))
      const errorAfterTurn = Math.abs(normalizeAngleRad(desired - heading))
      shouldAccelerate = errorAfterTurn <= ACCEL_CONE_RAD
    }

    const accel = shouldAccelerate
      ? HOMING_ORB_ACCEL_PX_PER_SEC2
      : -HOMING_ORB_TURN_DECEL_PX_PER_SEC2
    const speed = clamp(
      HomingOrb.speedPxPerSec[eid] + accel * TICK_DT_SEC,
      HOMING_ORB_MIN_SPEED_PX_PER_SEC,
      HOMING_ORB_MAX_SPEED_PX_PER_SEC,
    )
    HomingOrb.headingRad[eid] = heading
    HomingOrb.speedPxPerSec[eid] = speed
    Velocity.vx[eid] = Math.cos(heading) * speed
    Velocity.vy[eid] = Math.sin(heading) * speed
    Position.x[eid] += Velocity.vx[eid] * TICK_DT_SEC
    Position.y[eid] += Velocity.vy[eid] * TICK_DT_SEC

    const nextX = Position.x[eid]
    const nextY = Position.y[eid]
    const outOfBounds =
      nextX < -OVER || nextX > ARENA_WIDTH + OVER ||
      nextY < -OVER || nextY > ARENA_HEIGHT + OVER

    if (outOfBounds) {
      removeHomingOrb(ctx, eid)
    }
  }
}
