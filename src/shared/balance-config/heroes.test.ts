import { describe, it, expect } from "vitest"

import {
  DEFAULT_HERO_ID,
  HERO_CONFIGS,
  VALID_HERO_IDS,
  getHeroPrimaryMeleeAttackId,
  normalizeHeroId,
} from "./heroes"

describe("hero roster", () => {
  it("exposes only Yen and Triss with Yen as the default", () => {
    expect(DEFAULT_HERO_ID).toBe("yen")
    expect(VALID_HERO_IDS).toEqual(["yen", "triss"])
    expect(Object.keys(HERO_CONFIGS)).toEqual(["yen", "triss"])
    expect(HERO_CONFIGS.yen).toMatchObject({
      id: "yen",
      displayName: "Yen",
      spriteKey: "lady-wizard",
      primaryMeleeAttackId: "yen_cleaver",
    })
    expect(HERO_CONFIGS.triss).toMatchObject({
      id: "triss",
      displayName: "Triss",
      spriteKey: "triss",
      primaryMeleeAttackId: "triss_big_blast",
    })
  })

  it("normalizes legacy and unknown ids to Yen", () => {
    expect(normalizeHeroId("yen")).toBe("yen")
    expect(normalizeHeroId("triss")).toBe("triss")
    expect(normalizeHeroId("red_wizard")).toBe("yen")
    expect(normalizeHeroId("barbarian")).toBe("yen")
    expect(normalizeHeroId("ranger")).toBe("yen")
    expect(normalizeHeroId("not_a_real_hero")).toBe("yen")
  })
})

describe("getHeroPrimaryMeleeAttackId", () => {
  it("returns each hero's configured primary melee attack id", () => {
    expect(getHeroPrimaryMeleeAttackId("yen")).toBe("yen_cleaver")
    expect(getHeroPrimaryMeleeAttackId("triss")).toBe("triss_big_blast")
  })

  it("falls back to Yen's attack when hero id is legacy or unknown", () => {
    expect(getHeroPrimaryMeleeAttackId("red_wizard")).toBe("yen_cleaver")
    expect(getHeroPrimaryMeleeAttackId("barbarian")).toBe("yen_cleaver")
    expect(getHeroPrimaryMeleeAttackId("ranger")).toBe("yen_cleaver")
    expect(getHeroPrimaryMeleeAttackId("not_a_real_hero")).toBe(
      HERO_CONFIGS[DEFAULT_HERO_ID].primaryMeleeAttackId,
    )
  })
})
