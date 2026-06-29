import { describe, expect, it } from "vitest"

import { SFX_KEYS } from "./audio"
import { primaryAttackActionId } from "./animationConfig"
import { resolveSfxKeyForAction } from "./animationToolSfx"
import { HERO_CONFIGS, VALID_HERO_IDS } from "./heroes"

describe("resolveSfxKeyForAction", () => {
  it("returns castSfxKey for spell:fireball on Yen", () => {
    expect(resolveSfxKeyForAction("yen", "spell:fireball")).toBe("sfx-fireball-cast")
  })

  it("returns castSfxKey for spell:lightning_bolt", () => {
    expect(resolveSfxKeyForAction("triss", "spell:lightning_bolt")).toBe("sfx-lightning-cast")
  })

  it("returns castSfxKey for spell:jump", () => {
    expect(resolveSfxKeyForAction("triss", "spell:jump")).toBe("sfx-jump")
  })

  it("returns castSfxKey for spell:homing_orb", () => {
    expect(resolveSfxKeyForAction("yen", "spell:homing_orb")).toBe(
      SFX_KEYS.homingOrbCast,
    )
  })

  it("returns swingSfxKey for each hero primary action", () => {
    for (const heroId of VALID_HERO_IDS) {
      const hero = HERO_CONFIGS[heroId]
      const id = primaryAttackActionId(hero.primaryMeleeAttackId)
      expect(resolveSfxKeyForAction(heroId, id)).toBe("sfx-axe-swing")
    }
  })

  it("returns null when primary action id does not match hero loadout", () => {
    expect(resolveSfxKeyForAction("yen", "primary:triss_big_blast")).toBeNull()
  })

  it("returns null for behavior actions except walk footstep", () => {
    expect(resolveSfxKeyForAction("yen", "idle")).toBeNull()
    expect(resolveSfxKeyForAction("yen", "walk")).toBe(SFX_KEYS.walkStep)
    expect(resolveSfxKeyForAction("yen", "death")).toBeNull()
  })

  it("returns null for unknown hero", () => {
    expect(resolveSfxKeyForAction("unknown_hero", "spell:fireball")).toBeNull()
  })
})
