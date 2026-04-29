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
})
