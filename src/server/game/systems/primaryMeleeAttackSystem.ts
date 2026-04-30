/**
 * primaryMeleeAttackSystem – hero primary melee hurtbox attacks.
 *
 * Two-phase per tick:
 *  1. Process active swings: for each `ActiveMeleeAttack`, if elapsed time falls
 *     inside the attack's dangerous window, run hurtbox-vs-hitbox checks and
 *     queue damage for any new target overlap. Single-hit-per-attack is enforced
 *     by the per-instance `hitTargets` set. Once the swing duration elapses,
 *     remove the entry and (when expired this tick) the SwingingWeapon tag.
 *  2. Resolve new swing inputs: for each eligible player pressing primary fire,
 *     register a new ActiveMeleeAttack, tag SwingingWeapon, set the cooldown,
 *     and emit the swing-start payload (no hit list — damage resolves in phase 1
 *     across subsequent ticks).
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
import type { DamageRequest, SimCtx } from "../simulation"
import {
  PRIMARY_MELEE_ATTACK_CONFIGS,
  PRIMARY_MELEE_ATTACK_IDS,
  type PrimaryMeleeAttackId,
} from "../../../shared/balance-config/equipment"
import { getPrimaryAttackAnimationConfigByAttackId } from "../../../shared/balance-config/animationConfig"
import { TICK_MS } from "../../../shared/balance-config"
import { characterHitboxForCenter } from "../../../shared/collision/characterHitbox"
import { swingConeIntersectsCharacterHitbox } from "./swingConeGeometry"
import {
  combatTelegraphId,
  endCombatTelegraph,
  startCombatTelegraph,
} from "../combatTelegraphs"

/**
 * Runs the primary melee attack system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function primaryMeleeAttackSystem(ctx: SimCtx): void {
  const { world, currentTick, entityPlayerMap, primaryMeleeAttacks, activeMeleeAttacks } = ctx

  for (const eid of query(world, [PlayerTag, SwingingWeapon])) {
    if (currentTick >= Cooldown.primaryMelee[eid]) {
      removeComponent(world, eid, SwingingWeapon)
    }
  }

  resolveActiveSwings(ctx)

  for (const eid of query(world, [PlayerTag])) {
    const idx = Equipment.primaryMeleeAttackIndex[eid]
    if (idx < 0 || idx >= PRIMARY_MELEE_ATTACK_IDS.length) continue

    const attackId = PRIMARY_MELEE_ATTACK_IDS[idx] as PrimaryMeleeAttackId
    const cfg = PRIMARY_MELEE_ATTACK_CONFIGS[attackId]
    const timing = getPrimaryAttackAnimationConfigByAttackId(attackId)

    if (PlayerInput.weaponPrimary[eid] !== 1) continue
    if (hasComponent(world, eid, SwingingWeapon)) continue
    if (currentTick < Cooldown.primaryMelee[eid]) continue
    if (hasComponent(world, eid, DyingTag)) continue
    if (hasComponent(world, eid, DeadTag)) continue
    if (hasComponent(world, eid, SpectatorTag)) continue

    const swingTicks = Math.ceil(timing.durationMs / TICK_MS)

    addComponent(world, eid, SwingingWeapon)
    Cooldown.primaryMelee[eid] = currentTick + swingTicks

    const facing = Facing.angle[eid]
    const casterUserId = entityPlayerMap.get(eid) ?? ""
    const telegraphId = combatTelegraphId("primary", casterUserId, attackId, currentTick)

    activeMeleeAttacks.set(eid, {
      attackId,
      startTick: currentTick,
      facingAngle: facing,
      casterUserId,
      telegraphId,
      hitTargets: new Set<number>(),
    })

    startCombatTelegraph(ctx, {
      id: telegraphId,
      casterId: casterUserId,
      sourceId: attackId,
      anchor: "caster",
      directionRad: facing,
      shape: {
        type: "cone",
        radiusPx: cfg.hurtboxRadiusPx,
        arcDeg: cfg.hurtboxArcDeg,
      },
      startsAtServerTimeMs: ctx.serverTimeMs,
      dangerStartsAtServerTimeMs: ctx.serverTimeMs + timing.dangerousWindowStartMs,
      dangerEndsAtServerTimeMs: ctx.serverTimeMs + timing.dangerousWindowEndMs,
      endsAtServerTimeMs: ctx.serverTimeMs + timing.dangerousWindowEndMs,
    })

    primaryMeleeAttacks.push({
      casterId: casterUserId,
      attackId,
      x: Position.x[eid],
      y: Position.y[eid],
      facingAngle: facing,
      damage: cfg.damage,
      hurtboxRadiusPx: cfg.hurtboxRadiusPx,
      hurtboxArcDeg: cfg.hurtboxArcDeg,
      durationMs: timing.durationMs,
      dangerousWindowStartMs: timing.dangerousWindowStartMs,
      dangerousWindowEndMs: timing.dangerousWindowEndMs,
    })
  }
}

/**
 * Iterates active swings, applying damage during each attack's dangerous window
 * and removing entries whose duration has elapsed.
 *
 * @param ctx - Shared simulation context.
 */
function resolveActiveSwings(ctx: SimCtx): void {
  const { world, currentTick, damageRequests, activeMeleeAttacks } = ctx

  for (const [casterEid, atk] of activeMeleeAttacks) {
    const cfg = PRIMARY_MELEE_ATTACK_CONFIGS[atk.attackId]
    const timing = getPrimaryAttackAnimationConfigByAttackId(atk.attackId)
    const elapsedMs = (currentTick - atk.startTick) * TICK_MS

    if (
      hasComponent(world, casterEid, DyingTag) ||
      hasComponent(world, casterEid, DeadTag) ||
      hasComponent(world, casterEid, SpectatorTag)
    ) {
      endCombatTelegraph(
        ctx,
        atk.telegraphId,
        hasComponent(world, casterEid, SpectatorTag) ? "spectator" : "caster_dead",
      )
      activeMeleeAttacks.delete(casterEid)
      continue
    }

    if (elapsedMs >= timing.dangerousWindowEndMs) {
      endCombatTelegraph(ctx, atk.telegraphId, "expired")
    }

    if (elapsedMs >= timing.durationMs) {
      activeMeleeAttacks.delete(casterEid)
      continue
    }
    if (elapsedMs < timing.dangerousWindowStartMs) continue
    if (elapsedMs >= timing.dangerousWindowEndMs) continue

    const cx = Position.x[casterEid]
    const cy = Position.y[casterEid]

    for (const target of query(world, [PlayerTag])) {
      if (target === casterEid) continue
      if (atk.hitTargets.has(target)) continue
      if (hasComponent(world, target, DyingTag)) continue
      if (hasComponent(world, target, DeadTag)) continue
      if (hasComponent(world, target, SpectatorTag)) continue
      if (hasComponent(world, target, InvulnerableTag)) continue

      const targetHitbox = characterHitboxForCenter(Position.x[target], Position.y[target])
      if (
        !swingConeIntersectsCharacterHitbox(
          cx,
          cy,
          atk.facingAngle,
          cfg.hurtboxRadiusPx,
          cfg.hurtboxArcDeg,
          targetHitbox,
        )
      ) {
        continue
      }

      atk.hitTargets.add(target)

      const req: DamageRequest = {
        targetEid: target,
        damage: cfg.damage,
        killerUserId: atk.casterUserId,
        killerAbilityId: atk.attackId,
      }
      damageRequests.push(req)
    }
  }
}
