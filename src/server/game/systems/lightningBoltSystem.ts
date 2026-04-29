/**
 * lightningBoltSystem – resolves pending lightning bolt casts queued by
 * castingSystem this tick.
 *
 * For each cast:
 *  - Computes a main arc of length LIGHTNING_BOLT_ARC_PX from caster toward target.
 *  - Finds all enemy character hitboxes touched by the arc segment capsule.
 *  - Queues damage requests for each hit player.
 *  - Emits a LightningBoltPayload with a deterministic seed for branch geometry.
 *
 * The caster is always excluded from the target set.
 */
import { query, hasComponent } from "bitecs"

import {
  Position,
  PlayerTag,
  DyingTag,
  DeadTag,
  SpectatorTag,
  InvulnerableTag,
} from "../components"
import type { SimCtx, DamageRequest } from "../simulation"
import {
  LIGHTNING_BOLT_DAMAGE,
  LIGHTNING_BOLT_ARC_PX,
  LIGHTNING_HIT_RADIUS_PX,
} from "../../../shared/balance-config"
import {
  capsuleIntersectsRect,
  characterHitboxForCenter,
} from "../../../shared/collision/characterHitbox"

/**
 * Runs the lightning bolt system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function lightningBoltSystem(ctx: SimCtx): void {
  const { world, currentTick, pendingLightningBolts, damageRequests, lightningBolts, entityPlayerMap } = ctx

  for (const pending of pendingLightningBolts) {
    const { casterEid, casterUserId, targetX, targetY } = pending

    const originX = Position.x[casterEid]
    const originY = Position.y[casterEid]

    // Compute arc endpoint: ARC_PX in direction of target
    const dx = targetX - originX
    const dy = targetY - originY
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const endX = originX + (dx / len) * LIGHTNING_BOLT_ARC_PX
    const endY = originY + (dy / len) * LIGHTNING_BOLT_ARC_PX

    const hitPlayerIds: string[] = []

    for (const target of query(world, [PlayerTag])) {
      if (target === casterEid) continue
      if (hasComponent(world, target, DyingTag)) continue
      if (hasComponent(world, target, DeadTag)) continue
      if (hasComponent(world, target, SpectatorTag)) continue
      if (hasComponent(world, target, InvulnerableTag)) continue

      const hitbox = characterHitboxForCenter(Position.x[target], Position.y[target])
      if (
        !capsuleIntersectsRect(
          originX,
          originY,
          endX,
          endY,
          LIGHTNING_HIT_RADIUS_PX,
          hitbox,
        )
      ) {
        continue
      }

      const targetUserId = entityPlayerMap.get(target)
      if (targetUserId) hitPlayerIds.push(targetUserId)

      const req: DamageRequest = {
        targetEid: target,
        damage: LIGHTNING_BOLT_DAMAGE,
        killerUserId: casterUserId,
        killerAbilityId: "lightning_bolt",
      }
      damageRequests.push(req)
    }

    // Deterministic seed for client branch geometry: mix tick + casterEid
    const seed = ((currentTick * 1000003) ^ (casterEid * 999983)) >>> 0

    lightningBolts.push({
      casterId: casterUserId,
      originX,
      originY,
      targetX: endX,
      targetY: endY,
      seed,
      hitPlayerIds,
      damage: LIGHTNING_BOLT_DAMAGE,
    })
  }
}
