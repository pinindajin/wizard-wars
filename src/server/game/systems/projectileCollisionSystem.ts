/**
 * projectileCollisionSystem – checks fireball projectiles against live player
 * character hitboxes and queues DamageRequests when a hit is detected.
 *
 * Fireballs deal self-damage (caster can be hit by their own fireball).
 * Each fireball is removed on first hit.
 */
import { query } from "bitecs"

import {
  Position,
  Velocity,
  FireballTag,
  HomingOrbTag,
  Ownership,
} from "../components"
import type { SimCtx, DamageRequest } from "../simulation"
import {
  getDamageablePlayerTargets,
  getHomingOrbDamageableTargets,
  type HomingOrbDamageableTarget,
} from "../damageablePlayerCache"
import {
  FIREBALL_BLOCKED_BY_PROPS,
  FIREBALL_DAMAGE,
  FIREBALL_HIT_RADIUS_PX,
  FIREBALL_KNOCKBACK_PX,
  FIREBALL_OWNER_SELF_DAMAGE_GRACE_MS,
  HOMING_ORB_DAMAGE,
  HOMING_ORB_HIT_RADIUS_PX,
  TICK_MS,
} from "../../../shared/balance-config"
import { ARENA_PROP_COLLIDER_SET } from "../../../shared/collision/arenaSpatialIndexes"
import {
  circleIntersectsRect,
} from "../../../shared/collision/characterHitbox"
import { queryAabbIds } from "../../../shared/collision/spatialIndex"

const FIREBALL_OWNER_SELF_DAMAGE_GRACE_TICKS = Math.ceil(
  FIREBALL_OWNER_SELF_DAMAGE_GRACE_MS / TICK_MS,
)

function isWithinOwnerSelfDamageGrace(
  fireballCreatedAtTickMap: ReadonlyMap<number, number>,
  fbEid: number,
  currentTick: number,
): boolean {
  const createdAtTick = fireballCreatedAtTickMap.get(fbEid)
  return createdAtTick !== undefined &&
    currentTick - createdAtTick < FIREBALL_OWNER_SELF_DAMAGE_GRACE_TICKS
}

/**
 * Returns true when a Homing Orb can directly damage a player entity.
 *
 * @param ctx - Simulation context.
 * @param ownerEid - Projectile owner entity id.
 * @param ownerUserId - Projectile owner user id.
 * @param targetEid - Candidate player entity id.
 * @returns True when the target is a live, vulnerable enemy.
 */
function isValidHomingOrbHitTarget(
  ownerEid: number,
  ownerUserId: string | null,
  target: HomingOrbDamageableTarget,
): boolean {
  if (target.eid === ownerEid) return false
  return ownerUserId === null || target.userId !== ownerUserId
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
 * Runs the projectile collision system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function projectileCollisionSystem(ctx: SimCtx): void {
  const {
    world,
    currentTick,
    commandBuffer,
    fireballOwnerMap,
    fireballCreatedAtTickMap,
    fireballRemovedIds,
    fireballImpacts,
    homingOrbRemovedIds,
    homingOrbImpacts,
    homingOrbOwnerMap,
    damageRequests,
  } = ctx

  // Collect fireball IDs that have already been removed this tick to avoid
  // processing them again after a collision.
  const removedThisTick = new Set<number>(fireballRemovedIds)

  for (const fbEid of query(world, [FireballTag])) {
    if (removedThisTick.has(fbEid)) continue

    const fbX = Position.x[fbEid]
    const fbY = Position.y[fbEid]
    const ownerUserId = fireballOwnerMap.get(fbEid) ?? null
    const ownerInGrace = isWithinOwnerSelfDamageGrace(
      fireballCreatedAtTickMap,
      fbEid,
      currentTick,
    )

    if (FIREBALL_BLOCKED_BY_PROPS && fireballIntersectsArenaProp(fbX, fbY)) {
      fireballImpacts.push({ id: fbEid, x: fbX, y: fbY })
      removedThisTick.add(fbEid)
      fireballRemovedIds.push(fbEid)
      fireballOwnerMap.delete(fbEid)
      fireballCreatedAtTickMap.delete(fbEid)
      commandBuffer.enqueue({ type: "removeEntity", eid: fbEid })
      continue
    }

    for (const target of getDamageablePlayerTargets(ctx)) {
      const targetUserId = target.userId ?? null
      if (ownerInGrace && ownerUserId !== null && targetUserId === ownerUserId) continue

      if (!circleIntersectsRect(fbX, fbY, FIREBALL_HIT_RADIUS_PX, target.hitbox)) continue

      // Hit!
      // Knockback direction: away from fireball origin
      const vx = Velocity.vx[fbEid]
      const vy = Velocity.vy[fbEid]
      const speed = Math.sqrt(vx * vx + vy * vy) || 1

      const req: DamageRequest = {
        targetEid: target.eid,
        damage: FIREBALL_DAMAGE,
        killerUserId: ownerUserId,
        killerAbilityId: "fireball",
        knockbackX: vx / speed,
        knockbackY: vy / speed,
        knockbackPx: FIREBALL_KNOCKBACK_PX,
      }
      damageRequests.push(req)

      fireballImpacts.push({
        id: fbEid,
        x: fbX,
        y: fbY,
        targetId: targetUserId ?? undefined,
        damage: FIREBALL_DAMAGE,
        knockbackX: vx / speed,
        knockbackY: vy / speed,
      })

      removedThisTick.add(fbEid)
      fireballRemovedIds.push(fbEid)
      fireballOwnerMap.delete(fbEid)
      fireballCreatedAtTickMap.delete(fbEid)
      commandBuffer.enqueue({ type: "removeEntity", eid: fbEid })
      break // fireball consumed
    }
  }

  const removedHomingOrbsThisTick = new Set<number>(homingOrbRemovedIds)

  for (const orbEid of query(world, [HomingOrbTag])) {
    if (removedHomingOrbsThisTick.has(orbEid)) continue

    const orbX = Position.x[orbEid]
    const orbY = Position.y[orbEid]
    const ownerEid = Ownership.ownerEid[orbEid]
    const ownerUserId = homingOrbOwnerMap.get(orbEid) ?? null

    for (const target of getHomingOrbDamageableTargets(ctx)) {
      if (!isValidHomingOrbHitTarget(ownerEid, ownerUserId, target)) continue

      const targetUserId = target.userId
      if (!circleIntersectsRect(orbX, orbY, HOMING_ORB_HIT_RADIUS_PX, target.hitbox)) continue

      const req: DamageRequest = {
        targetEid: target.eid,
        damage: HOMING_ORB_DAMAGE,
        killerUserId: ownerUserId,
        killerAbilityId: "homing_orb",
      }
      damageRequests.push(req)

      homingOrbImpacts.push({
        id: orbEid,
        x: orbX,
        y: orbY,
        reason: "hit",
        targetId: targetUserId,
        hitPlayerIds: targetUserId !== undefined ? [targetUserId] : [],
        damage: HOMING_ORB_DAMAGE,
      })

      removedHomingOrbsThisTick.add(orbEid)
      removeHomingOrb(ctx, orbEid)
      break
    }
  }
}

function fireballIntersectsArenaProp(fbX: number, fbY: number): boolean {
  const nearbyIds = queryAabbIds(
    ARENA_PROP_COLLIDER_SET.index,
    {
      x: fbX - FIREBALL_HIT_RADIUS_PX,
      y: fbY - FIREBALL_HIT_RADIUS_PX,
      width: FIREBALL_HIT_RADIUS_PX * 2,
      height: FIREBALL_HIT_RADIUS_PX * 2,
    },
    ARENA_PROP_COLLIDER_SET.scratch,
  )

  for (const id of nearbyIds) {
    const rect = ARENA_PROP_COLLIDER_SET.rects[id]
    if (rect && circleIntersectsRect(fbX, fbY, FIREBALL_HIT_RADIUS_PX, rect)) return true
  }
  return false
}
