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

export type DamageablePlayerTarget = {
  readonly eid: number
  readonly userId: string | undefined
  readonly x: number
  readonly y: number
  readonly hitbox: CharacterHitboxRect
}

export type HomingOrbDamageableTarget = DamageablePlayerTarget & {
  readonly userId: string
}

/**
 * Builds a fresh live/vulnerable player hitbox list in `PlayerTag` query order.
 *
 * @param ctx - Simulation context to scan.
 * @returns Fresh damageable player targets.
 */
function buildDamageablePlayerTargets(ctx: SimCtx): DamageablePlayerTarget[] {
  const targets: DamageablePlayerTarget[] = []
  for (const eid of query(ctx.world, [PlayerTag])) {
    if (hasComponent(ctx.world, eid, DyingTag)) continue
    if (hasComponent(ctx.world, eid, DeadTag)) continue
    if (hasComponent(ctx.world, eid, SpectatorTag)) continue
    if (hasComponent(ctx.world, eid, InvulnerableTag)) continue

    const x = Position.x[eid]
    const y = Position.y[eid]
    targets.push({
      eid,
      userId: ctx.entityPlayerMap.get(eid),
      x,
      y,
      hitbox: characterHitboxForCenter(x, y),
    })
  }
  return targets
}

/**
 * Clears the tick-local damageable-player caches before a new simulation tick.
 *
 * @param ctx - Simulation context for the current tick.
 */
export function resetDamageablePlayerTargetCaches(ctx: SimCtx): void {
  ctx.damageablePlayerTargetCache = undefined
  ctx.homingOrbDamageableTargetCache = undefined
}

/**
 * Rebuilds the tick-local damageable-player cache from current player positions.
 *
 * @param ctx - Simulation context for the current tick.
 * @returns Cached damageable player hitboxes in `PlayerTag` query order.
 */
export function rebuildDamageablePlayerTargets(
  ctx: SimCtx,
): readonly DamageablePlayerTarget[] {
  const targets = buildDamageablePlayerTargets(ctx)
  ctx.damageablePlayerTargetCache = targets
  ctx.homingOrbDamageableTargetCache = undefined
  return targets
}

/**
 * Returns the tick-local cache of live, vulnerable player hitboxes.
 *
 * @param ctx - Simulation context for the current tick.
 * @returns Cached damageable player hitboxes in `PlayerTag` query order.
 */
export function getDamageablePlayerTargets(ctx: SimCtx): readonly DamageablePlayerTarget[] {
  if (ctx.damageablePlayerTargetCache) return ctx.damageablePlayerTargetCache
  return rebuildDamageablePlayerTargets(ctx)
}

/**
 * Returns the tick-local mapped-player view used by Homing Orb systems.
 *
 * @param ctx - Simulation context for the current tick.
 * @returns Cached damageable player hitboxes with stable user ids.
 */
export function getHomingOrbDamageableTargets(
  ctx: SimCtx,
): readonly HomingOrbDamageableTarget[] {
  if (ctx.homingOrbDamageableTargetCache) return ctx.homingOrbDamageableTargetCache

  const targets = getDamageablePlayerTargets(ctx).filter(
    (target): target is HomingOrbDamageableTarget => target.userId !== undefined,
  )
  ctx.homingOrbDamageableTargetCache = targets
  return targets
}
