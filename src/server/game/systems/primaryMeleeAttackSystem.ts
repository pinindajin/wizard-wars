/**
 * primaryMeleeAttackSystem – hero primary melee cone attacks (cleaver-style).
 *
 * On each tick:
 *  1. For players currently SwingingWeapon: remove the tag when the swing
 *     duration has expired (`Cooldown.primaryMelee` tick has passed).
 *  2. For eligible players (configured primary attack, primary-fire input,
 *     cooldown ready, not already swinging, alive): start a swing, immediately
 *     check for hits in the arc, queue damage requests, emit payload.
 */
import { query, hasComponent, addComponent, removeComponent } from "bitecs"

import {
  Position,
  Facing,
  Equipment,
  Cooldown,
  PlayerInput,
  PlayerTag,
  SwingingWeapon,
  DyingTag,
  DeadTag,
  SpectatorTag,
  InvulnerableTag,
} from "../components"
import type { SimCtx, DamageRequest } from "../simulation"
import {
  PRIMARY_MELEE_ATTACK_CONFIGS,
  PRIMARY_MELEE_ATTACK_IDS,
  type PrimaryMeleeAttackId,
} from "../../../shared/balance-config/equipment"
import { TICK_MS } from "../../../shared/balance-config"
import { inSwingCone } from "./swingConeGeometry"

/**
 * Runs the primary melee attack system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function primaryMeleeAttackSystem(ctx: SimCtx): void {
  const { world, currentTick, entityPlayerMap, primaryMeleeAttacks, damageRequests } = ctx

  for (const eid of query(world, [PlayerTag, SwingingWeapon])) {
    if (currentTick >= Cooldown.primaryMelee[eid]) {
      removeComponent(world, eid, SwingingWeapon)
    }
  }

  for (const eid of query(world, [PlayerTag])) {
    const idx = Equipment.primaryMeleeAttackIndex[eid]
    if (idx < 0 || idx >= PRIMARY_MELEE_ATTACK_IDS.length) continue

    const attackId = PRIMARY_MELEE_ATTACK_IDS[idx] as PrimaryMeleeAttackId
    const cfg = PRIMARY_MELEE_ATTACK_CONFIGS[attackId]

    if (PlayerInput.weaponPrimary[eid] !== 1) continue
    if (hasComponent(world, eid, SwingingWeapon)) continue
    if (currentTick < Cooldown.primaryMelee[eid]) continue
    if (hasComponent(world, eid, DyingTag)) continue
    if (hasComponent(world, eid, DeadTag)) continue
    if (hasComponent(world, eid, SpectatorTag)) continue

    const swingTicks = Math.ceil(cfg.durationMs / TICK_MS)

    addComponent(world, eid, SwingingWeapon)
    Cooldown.primaryMelee[eid] = currentTick + swingTicks

    const cx = Position.x[eid]
    const cy = Position.y[eid]
    const facing = Facing.angle[eid]
    const casterUserId = entityPlayerMap.get(eid) ?? ""

    const hitPlayerIds: string[] = []
    for (const target of query(world, [PlayerTag])) {
      if (target === eid) continue
      if (hasComponent(world, target, DyingTag)) continue
      if (hasComponent(world, target, DeadTag)) continue
      if (hasComponent(world, target, SpectatorTag)) continue
      if (hasComponent(world, target, InvulnerableTag)) continue

      if (
        !inSwingCone(
          cx,
          cy,
          facing,
          Position.x[target],
          Position.y[target],
          cfg.radiusPx,
          cfg.arcDeg,
        )
      ) {
        continue
      }

      const targetUserId = entityPlayerMap.get(target)
      if (targetUserId) hitPlayerIds.push(targetUserId)

      const req: DamageRequest = {
        targetEid: target,
        damage: cfg.damage,
        killerUserId: casterUserId,
        killerAbilityId: attackId,
      }
      damageRequests.push(req)
    }

    primaryMeleeAttacks.push({
      casterId: casterUserId,
      attackId,
      x: cx,
      y: cy,
      facingAngle: facing,
      hitPlayerIds,
      damage: cfg.damage,
      radiusPx: cfg.radiusPx,
      arcDeg: cfg.arcDeg,
      durationMs: cfg.durationMs,
    })
  }
}
