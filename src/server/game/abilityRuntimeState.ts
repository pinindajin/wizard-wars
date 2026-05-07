import {
  FIREBALL_COOLDOWN_MS,
  JUMP_CHARGE_RECHARGE_MS,
  JUMP_MAX_CHARGES,
  LIGHTNING_COOLDOWN_MS,
  TICK_MS,
} from "@/shared/balance-config"
import type { AbilityRuntimeState, AbilityRuntimeStates } from "@/shared/types"

import { AbilityRuntime, Cooldown } from "./components"

const FIREBALL_COOLDOWN_TICKS = Math.ceil(FIREBALL_COOLDOWN_MS / TICK_MS)
const LIGHTNING_COOLDOWN_TICKS = Math.ceil(LIGHTNING_COOLDOWN_MS / TICK_MS)
const JUMP_RECHARGE_TICKS = Math.ceil(JUMP_CHARGE_RECHARGE_MS / TICK_MS)

/**
 * Converts a tick duration to the wall-clock span represented by the simulation.
 *
 * @param ticks - Duration in authoritative simulation ticks.
 * @returns Duration in milliseconds.
 */
function ticksToMs(ticks: number): number {
  return ticks * TICK_MS
}

/**
 * Builds a non-charge ability state from its cooldown tick and stored end time.
 *
 * @param readyTick - Simulation tick at which the ability becomes usable.
 * @param endsAtMs - Server wall-clock time stored when the cooldown began.
 * @param durationMs - Cooldown duration represented by the authoritative ticks.
 * @param currentTick - Current authoritative simulation tick.
 * @returns Client-visible ability runtime state.
 */
function cooldownState(
  readyTick: number,
  endsAtMs: number,
  durationMs: number,
  currentTick: number,
): AbilityRuntimeState {
  const onCooldown = currentTick < readyTick && endsAtMs > 0
  return {
    cooldownEndsAtServerTimeMs: onCooldown ? endsAtMs : null,
    cooldownDurationMs: onCooldown ? durationMs : null,
    charges: null,
    maxCharges: null,
    rechargeEndsAtServerTimeMs: null,
    rechargeDurationMs: null,
  }
}

/**
 * Builds the charge-based runtime state for Jump.
 *
 * @param eid - Player entity id.
 * @returns Client-visible Jump runtime state.
 */
function jumpState(eid: number): AbilityRuntimeState {
  const charges = AbilityRuntime.jumpCharges[eid]
  const recharging = charges < JUMP_MAX_CHARGES && AbilityRuntime.jumpRechargeEndsAtMs[eid] > 0
  const rechargeEndsAtMs = recharging ? AbilityRuntime.jumpRechargeEndsAtMs[eid] : null
  const rechargeDurationMs = recharging ? ticksToMs(JUMP_RECHARGE_TICKS) : null
  return {
    cooldownEndsAtServerTimeMs: charges === 0 ? rechargeEndsAtMs : null,
    cooldownDurationMs: charges === 0 ? rechargeDurationMs : null,
    charges,
    maxCharges: JUMP_MAX_CHARGES,
    rechargeEndsAtServerTimeMs: rechargeEndsAtMs,
    rechargeDurationMs,
  }
}

/**
 * Builds all ability runtime states exposed for one player.
 *
 * @param eid - Player entity id.
 * @param currentTick - Current authoritative simulation tick.
 * @returns Ability id keyed runtime states.
 */
export function abilityRuntimeStatesForPlayer(
  eid: number,
  currentTick: number,
): AbilityRuntimeStates {
  return {
    fireball: cooldownState(
      Cooldown.fireball[eid],
      AbilityRuntime.fireballCooldownEndsAtMs[eid],
      ticksToMs(FIREBALL_COOLDOWN_TICKS),
      currentTick,
    ),
    lightning_bolt: cooldownState(
      Cooldown.lightningBolt[eid],
      AbilityRuntime.lightningBoltCooldownEndsAtMs[eid],
      ticksToMs(LIGHTNING_COOLDOWN_TICKS),
      currentTick,
    ),
    jump: jumpState(eid),
  }
}

/**
 * Compares two ability runtime state maps by value.
 *
 * @param a - First runtime state map.
 * @param b - Second runtime state map.
 * @returns True when all known ability fields match.
 */
export function abilityRuntimeStatesEqual(
  a: AbilityRuntimeStates,
  b: AbilityRuntimeStates,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const left = a[key]
    const right = b[key]
    if (!left || !right) return false
    if (left.cooldownEndsAtServerTimeMs !== right.cooldownEndsAtServerTimeMs) return false
    if (left.cooldownDurationMs !== right.cooldownDurationMs) return false
    if (left.charges !== right.charges) return false
    if (left.maxCharges !== right.maxCharges) return false
    if (left.rechargeEndsAtServerTimeMs !== right.rechargeEndsAtServerTimeMs) return false
    if (left.rechargeDurationMs !== right.rechargeDurationMs) return false
  }
  return true
}
