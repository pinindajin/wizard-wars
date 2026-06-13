import { describe, expect, it } from "vitest"

import {
  FIREBALL_COOLDOWN_MS,
  HOMING_ORB_CHARGE_RECHARGE_MS,
  HOMING_ORB_MAX_CHARGES,
  JUMP_CHARGE_RECHARGE_MS,
  JUMP_MAX_CHARGES,
  TICK_MS,
} from "@/shared/balance-config"
import type { AbilityRuntimeStates } from "@/shared/types"

import {
  abilityRuntimeStatesEqual,
  abilityRuntimeStatesForPlayer,
} from "./abilityRuntimeState"
import { AbilityRuntime, Cooldown } from "./components"

const EID = 77

function resetRuntime(): void {
  Cooldown.fireball[EID] = 0
  Cooldown.lightningBolt[EID] = 0
  AbilityRuntime.fireballCooldownEndsAtMs[EID] = 0
  AbilityRuntime.lightningBoltCooldownEndsAtMs[EID] = 0
  AbilityRuntime.jumpCharges[EID] = JUMP_MAX_CHARGES
  AbilityRuntime.jumpRechargeReadyTick[EID] = 0
  AbilityRuntime.jumpRechargeEndsAtMs[EID] = 0
  AbilityRuntime.homingOrbCharges[EID] = HOMING_ORB_MAX_CHARGES
  AbilityRuntime.homingOrbRechargeReadyTick[EID] = 0
  AbilityRuntime.homingOrbRechargeEndsAtMs[EID] = 0
}

function readyStates(): AbilityRuntimeStates {
  return {
    fireball: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: null,
      maxCharges: null,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    jump: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: JUMP_MAX_CHARGES,
      maxCharges: JUMP_MAX_CHARGES,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
    homing_orb: {
      cooldownEndsAtServerTimeMs: null,
      cooldownDurationMs: null,
      charges: HOMING_ORB_MAX_CHARGES,
      maxCharges: HOMING_ORB_MAX_CHARGES,
      rechargeEndsAtServerTimeMs: null,
      rechargeDurationMs: null,
    },
  }
}

describe("abilityRuntimeStatesForPlayer", () => {
  it("exposes and clears non-charge cooldown state by authoritative tick", () => {
    resetRuntime()
    const cooldownTicks = Math.ceil(FIREBALL_COOLDOWN_MS / TICK_MS)
    Cooldown.fireball[EID] = 10 + cooldownTicks
    AbilityRuntime.fireballCooldownEndsAtMs[EID] = 5_000

    const active = abilityRuntimeStatesForPlayer(EID, 10)
    expect(active.fireball).toMatchObject({
      cooldownEndsAtServerTimeMs: 5_000,
      cooldownDurationMs: cooldownTicks * TICK_MS,
      charges: null,
    })

    const ready = abilityRuntimeStatesForPlayer(EID, 10 + cooldownTicks)
    expect(ready.fireball.cooldownEndsAtServerTimeMs).toBeNull()
    expect(ready.fireball.cooldownDurationMs).toBeNull()
  })

  it("mirrors jump recharge into cooldown only when charges are depleted", () => {
    resetRuntime()
    AbilityRuntime.jumpCharges[EID] = 2
    AbilityRuntime.jumpRechargeEndsAtMs[EID] = 12_000

    const usable = abilityRuntimeStatesForPlayer(EID, 10).jump
    expect(usable).toMatchObject({
      charges: 2,
      cooldownEndsAtServerTimeMs: null,
      rechargeEndsAtServerTimeMs: 12_000,
      rechargeDurationMs: Math.ceil(JUMP_CHARGE_RECHARGE_MS / TICK_MS) * TICK_MS,
    })

    AbilityRuntime.jumpCharges[EID] = 0
    const depleted = abilityRuntimeStatesForPlayer(EID, 10).jump
    expect(depleted).toMatchObject({
      charges: 0,
      cooldownEndsAtServerTimeMs: 12_000,
      cooldownDurationMs: Math.ceil(JUMP_CHARGE_RECHARGE_MS / TICK_MS) * TICK_MS,
    })
  })

  it("mirrors homing orb charges and recharge timing", () => {
    resetRuntime()
    AbilityRuntime.homingOrbCharges[EID] = 3
    AbilityRuntime.homingOrbRechargeEndsAtMs[EID] = 30_000

    const usable = abilityRuntimeStatesForPlayer(EID, 10).homing_orb
    expect(usable).toMatchObject({
      charges: 3,
      maxCharges: HOMING_ORB_MAX_CHARGES,
      cooldownEndsAtServerTimeMs: null,
      rechargeEndsAtServerTimeMs: 30_000,
      rechargeDurationMs: Math.ceil(HOMING_ORB_CHARGE_RECHARGE_MS / TICK_MS) * TICK_MS,
    })

    AbilityRuntime.homingOrbCharges[EID] = 0
    const depleted = abilityRuntimeStatesForPlayer(EID, 10).homing_orb
    expect(depleted).toMatchObject({
      charges: 0,
      cooldownEndsAtServerTimeMs: 30_000,
      cooldownDurationMs: Math.ceil(HOMING_ORB_CHARGE_RECHARGE_MS / TICK_MS) * TICK_MS,
    })
  })
})

describe("abilityRuntimeStatesEqual", () => {
  it("compares equal runtime maps by value", () => {
    expect(abilityRuntimeStatesEqual(readyStates(), readyStates())).toBe(true)
  })

  it.each([
    ["missing key", { jump: undefined }],
    ["cooldown end", { fireball: { cooldownEndsAtServerTimeMs: 1 } }],
    ["cooldown duration", { fireball: { cooldownDurationMs: 1 } }],
    ["charges", { jump: { charges: 3 } }],
    ["max charges", { jump: { maxCharges: 5 } }],
    ["recharge end", { jump: { rechargeEndsAtServerTimeMs: 1 } }],
    ["recharge duration", { jump: { rechargeDurationMs: 1 } }],
  ])("returns false for %s mismatch", (_label, patch) => {
    const left = readyStates()
    const right = readyStates()

    for (const [abilityId, fields] of Object.entries(patch)) {
      if (fields === undefined) {
        delete right[abilityId]
      } else {
        right[abilityId] = { ...right[abilityId]!, ...fields }
      }
    }

    expect(abilityRuntimeStatesEqual(left, right)).toBe(false)
  })
})
