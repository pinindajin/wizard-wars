import { describe, it, expect } from "vitest"

import {
  PRIMARY_MELEE_ATTACK_CONFIGS,
  PRIMARY_MELEE_ATTACK_IDS,
  primaryMeleeAttackIdToIndex,
  primaryMeleeAttackIndexToId,
} from "./equipment"

describe("primaryMeleeAttackIdToIndex", () => {
  it("returns stable indices for each canonical id", () => {
    for (let i = 0; i < PRIMARY_MELEE_ATTACK_IDS.length; i++) {
      const id = PRIMARY_MELEE_ATTACK_IDS[i]!
      expect(primaryMeleeAttackIdToIndex(id)).toBe(i)
    }
  })
})

describe("primaryMeleeAttackIndexToId", () => {
  it("round-trips with idToIndex for in-range indices", () => {
    for (let i = 0; i < PRIMARY_MELEE_ATTACK_IDS.length; i++) {
      expect(primaryMeleeAttackIndexToId(i)).toBe(PRIMARY_MELEE_ATTACK_IDS[i])
    }
  })

  it("returns null for negative or out-of-range indices", () => {
    expect(primaryMeleeAttackIndexToId(-1)).toBeNull()
    expect(primaryMeleeAttackIndexToId(PRIMARY_MELEE_ATTACK_IDS.length)).toBeNull()
  })
})

describe("PRIMARY_MELEE_ATTACK_CONFIGS", () => {
  it("defines a config entry for every canonical attack id", () => {
    for (const id of PRIMARY_MELEE_ATTACK_IDS) {
      expect(PRIMARY_MELEE_ATTACK_CONFIGS[id].id).toBe(id)
    }
  })

  it("keeps existing attacks stable and gives Helena the requested cone", () => {
    expect(PRIMARY_MELEE_ATTACK_IDS).toEqual([
      "yen_cleaver",
      "triss_big_blast",
      "helena_energy_wave",
    ])

    const yen = PRIMARY_MELEE_ATTACK_CONFIGS.yen_cleaver
    const triss = PRIMARY_MELEE_ATTACK_CONFIGS.triss_big_blast
    const helena = PRIMARY_MELEE_ATTACK_CONFIGS.helena_energy_wave

    expect(yen).toMatchObject({
      displayName: "Yen Cleaver",
      hurtboxRadiusPx: 45,
      hurtboxArcDeg: 180,
    })
    expect(triss).toMatchObject({
      displayName: "Triss Big Blast",
      hurtboxRadiusPx: 54,
      hurtboxArcDeg: 126,
    })
    expect(triss.damage).toBe(yen.damage)
    expect(triss.durationMs).toBe(yen.durationMs)
    expect(triss.dangerousWindowStartMs).toBe(yen.dangerousWindowStartMs)
    expect(triss.dangerousWindowEndMs).toBe(yen.dangerousWindowEndMs)
    expect(triss.damageProperties).toBe(yen.damageProperties)
    expect(triss.swingSfxKey).toBe(yen.swingSfxKey)
    expect(helena).toMatchObject({
      displayName: "Helena Energy Wave",
      hurtboxRadiusPx: 67.5,
      hurtboxArcDeg: 75.6,
    })
    expect(helena.damage).toBe(triss.damage)
    expect(helena.durationMs).toBe(triss.durationMs)
    expect(helena.dangerousWindowStartMs).toBe(triss.dangerousWindowStartMs)
    expect(helena.dangerousWindowEndMs).toBe(triss.dangerousWindowEndMs)
    expect(helena.damageProperties).toBe(triss.damageProperties)
    expect(helena.swingSfxKey).toBe(triss.swingSfxKey)
  })
})
