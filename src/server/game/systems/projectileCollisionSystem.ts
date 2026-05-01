/**
 * projectileCollisionSystem – checks fireball projectiles against live player
 * character hitboxes and queues DamageRequests when a hit is detected.
 *
 * Fireballs deal self-damage (caster can be hit by their own fireball).
 * Each fireball is removed on first hit.
 */
import { query, hasComponent } from "bitecs"

import {
  Position,
  Velocity,
  FireballTag,
  PlayerTag,
  DyingTag,
  DeadTag,
  SpectatorTag,
  InvulnerableTag,
} from "../components"
import type { SimCtx, DamageRequest } from "../simulation"
import {
  FIREBALL_DAMAGE,
  FIREBALL_KNOCKBACK_PX,
  FIREBALL_OWNER_SELF_DAMAGE_GRACE_MS,
  TICK_MS,
} from "../../../shared/balance-config"
import {
  characterHitboxForCenter,
  circleIntersectsRect,
} from "../../../shared/collision/characterHitbox"

/** Approximate fireball hit radius in pixels. */
const FIREBALL_RADIUS = 8
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
 * Runs the projectile collision system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function projectileCollisionSystem(ctx: SimCtx): void {
  const {
    world,
    currentTick,
    commandBuffer,
    entityPlayerMap,
    fireballOwnerMap,
    fireballCreatedAtTickMap,
    fireballRemovedIds,
    fireballImpacts,
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

    for (const playerEid of query(world, [PlayerTag])) {
      if (hasComponent(world, playerEid, DyingTag)) continue
      if (hasComponent(world, playerEid, DeadTag)) continue
      if (hasComponent(world, playerEid, SpectatorTag)) continue
      if (hasComponent(world, playerEid, InvulnerableTag)) continue

      const targetUserId = entityPlayerMap.get(playerEid) ?? null
      if (ownerInGrace && ownerUserId !== null && targetUserId === ownerUserId) continue

      const hitbox = characterHitboxForCenter(Position.x[playerEid], Position.y[playerEid])
      if (!circleIntersectsRect(fbX, fbY, FIREBALL_RADIUS, hitbox)) continue

      // Hit!
      // Knockback direction: away from fireball origin
      const vx = Velocity.vx[fbEid]
      const vy = Velocity.vy[fbEid]
      const speed = Math.sqrt(vx * vx + vy * vy) || 1

      const req: DamageRequest = {
        targetEid: playerEid,
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
}
