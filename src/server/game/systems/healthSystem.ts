/**
 * healthSystem – processes all DamageRequests queued this tick.
 *
 * For each request:
 *  - Applies damage to Health.current.
 *  - Adds DamageFlash visual indicator.
 *  - Emits a DamageFloatPayload.
 *  - Applies knockback if specified.
 *  - If Health.current drops to ≤ 0 and entity is not already dying: adds
 *    DyingTag with an expiresAtMs timer and records a DeathEvent.
 *
 * Expired DamageFlash timers are also cleaned up here as a pre-pass.
 */
import { query, hasComponent, addComponent, removeComponent } from "bitecs"

import {
  PlayerTag,
  Health,
  Position,
  Knockback,
  DyingTag,
  DeadTag,
  SpectatorTag,
  DamageFlash,
  DamageFlashTag,
  InvulnerableTag,
} from "../components"
import type { SimCtx, DamageRequest, DeathEvent } from "../simulation"
import {
  DAMAGE_FLASH_MS,
  DEATH_ANIM_MS,
  INVULNERABLE_WINDOW_MS,
} from "../../../shared/balance-config"
import { TICK_MS } from "../../../shared/balance-config"

const INVULNERABLE_TICKS = Math.ceil(INVULNERABLE_WINDOW_MS / TICK_MS)

/**
 * Runs the health system for one tick.
 *
 * @param ctx - Shared simulation context.
 */
export function healthSystem(ctx: SimCtx): void {
  const { world, serverTimeMs, currentTick, damageRequests, deathEvents, damageFloats, entityPlayerMap } = ctx

  // ── 1. Clear expired DamageFlash tags ────────────────────────────────
  for (const eid of query(world, [PlayerTag, DamageFlashTag])) {
    if (serverTimeMs >= DamageFlash.expiresAtMs[eid]) {
      removeComponent(world, eid, DamageFlashTag)
    }
  }

  // ── 2. Process damage requests ───────────────────────────────────────
  for (const req of damageRequests) {
    const { targetEid, damage, killerUserId, killerAbilityId, knockbackX, knockbackY, knockbackPx } = req

    // Guard: entity must still be alive and eligible
    if (!hasComponent(world, targetEid, PlayerTag)) continue
    if (hasComponent(world, targetEid, DyingTag)) continue
    if (hasComponent(world, targetEid, DeadTag)) continue
    if (hasComponent(world, targetEid, SpectatorTag)) continue
    if (hasComponent(world, targetEid, InvulnerableTag)) continue

    // Apply damage
    Health.current[targetEid] = Math.max(0, Health.current[targetEid] - damage)

    // Damage flash
    if (!hasComponent(world, targetEid, DamageFlashTag)) {
      addComponent(world, targetEid, DamageFlashTag)
    }
    addComponent(world, targetEid, DamageFlash)
    DamageFlash.expiresAtMs[targetEid] = serverTimeMs + DAMAGE_FLASH_MS

    // Knockback
    if (knockbackX !== undefined && knockbackY !== undefined && knockbackPx) {
      addComponent(world, targetEid, Knockback)
      Knockback.impulseX[targetEid] = knockbackX
      Knockback.impulseY[targetEid] = knockbackY
      Knockback.remainingPx[targetEid] = knockbackPx
    }

    // Damage float event
    const targetUserId = entityPlayerMap.get(targetEid) ?? ""
    damageFloats.push({
      targetId: targetUserId,
      amount: damage,
      x: Position.x[targetEid],
      y: Position.y[targetEid],
    })

    // Death trigger
    if (Health.current[targetEid] <= 0) {
      addComponent(world, targetEid, DyingTag)
      DyingTag.expiresAtMs[targetEid] = serverTimeMs + DEATH_ANIM_MS

      const userId = entityPlayerMap.get(targetEid) ?? ""
      const death: DeathEvent = {
        playerEid: targetEid,
        userId,
        killerUserId,
        killerAbilityId,
      }
      deathEvents.push(death)
    }
  }
}
