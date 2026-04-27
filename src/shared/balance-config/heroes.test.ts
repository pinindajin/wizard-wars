import { describe, it, expect } from "vitest"

import { DEFAULT_HERO_ID, HERO_CONFIGS, getHeroPrimaryMeleeAttackId } from "./heroes"

describe("getHeroPrimaryMeleeAttackId", () => {
  it("returns each hero's configured primary melee attack id", () => {
    expect(getHeroPrimaryMeleeAttackId("red_wizard")).toBe("red_wizard_cleaver")
    expect(getHeroPrimaryMeleeAttackId("barbarian")).toBe("barbarian_cleaver")
    expect(getHeroPrimaryMeleeAttackId("ranger")).toBe("ranger_cleaver")
  })

  it("falls back to the default hero's attack when hero id is unknown", () => {
    expect(getHeroPrimaryMeleeAttackId("not_a_real_hero")).toBe(
      HERO_CONFIGS[DEFAULT_HERO_ID].primaryMeleeAttackId,
    )
  })
})
