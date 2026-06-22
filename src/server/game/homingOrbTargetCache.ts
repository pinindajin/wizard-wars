import { hasComponent, query } from "bitecs"

import {
  DeadTag,
  DyingTag,
  InvulnerableTag,
  PlayerTag,
  Position,
  SpectatorTag,
} from "./components"
import type { SimCtx } from "./simulation"
import {
  characterHitboxForCenter,
  type CharacterHitboxRect,
} from "@/shared/collision/characterHitbox"

export type HomingOrbDamageableTarget = {
  readonly eid: number
  readonly userId: string
  readonly x: number
  readonly y: number
  readonly hitbox: CharacterHitboxRect
}

/**
 * Returns the tick-local cache of live player hitboxes that Homing Orbs can damage.
 *
 * @param ctx - Simulation context for the current tick.
 * @returns Cached damageable player hitboxes.
 */
export function getHomingOrbDamageableTargets(
  ctx: SimCtx,
): readonly HomingOrbDamageableTarget[] {
  if (ctx.homingOrbDamageableTargetCache) return ctx.homingOrbDamageableTargetCache

  const targets: HomingOrbDamageableTarget[] = []
  for (const eid of query(ctx.world, [PlayerTag])) {
    if (hasComponent(ctx.world, eid, DyingTag)) continue
    if (hasComponent(ctx.world, eid, DeadTag)) continue
    if (hasComponent(ctx.world, eid, SpectatorTag)) continue
    if (hasComponent(ctx.world, eid, InvulnerableTag)) continue
    const userId = ctx.entityPlayerMap.get(eid)
    if (userId === undefined) continue
    const x = Position.x[eid]
    const y = Position.y[eid]
    targets.push({
      eid,
      userId,
      x,
      y,
      hitbox: characterHitboxForCenter(x, y),
    })
  }
  ctx.homingOrbDamageableTargetCache = targets
  return targets
}
