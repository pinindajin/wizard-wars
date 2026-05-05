import { describe, expect, it } from "vitest"

import { primaryAttackActionId } from "./animationConfig"
import { resolveSfxKeyForAction } from "./animationToolSfx"
import { HERO_CONFIGS } from "./heroes"

describe("resolveSfxKeyForAction", () => {
  it("returns castSfxKey for spell:fireball on red_wizard", () => {
    expect(resolveSfxKeyForAction("red_wizard", "spell:fireball")).toBe("sfx-fireball-cast")
  })

  it("returns castSfxKey for spell:lightning_bolt", () => {
    expect(resolveSfxKeyForAction("barbarian", "spell:lightning_bolt")).toBe("sfx-lightning-cast")
  })

  it("returns castSfxKey for spell:jump", () => {
    expect(resolveSfxKeyForAction("ranger", "spell:jump")).toBe("sfx-jump")
  })

  it("returns swingSfxKey for each hero primary action", () => {
    for (const heroId of Object.keys(HERO_CONFIGS)) {
      const hero = HERO_CONFIGS[heroId]!
      const id = primaryAttackActionId(hero.primaryMeleeAttackId)
      expect(resolveSfxKeyForAction(heroId, id)).toBe("sfx-axe-swing")
    }
  })

  it("returns null when primary action id does not match hero loadout", () => {
    expect(resolveSfxKeyForAction("red_wizard", "primary:ranger_cleaver")).toBeNull()
  })

  it("returns null for behavior actions", () => {
    expect(resolveSfxKeyForAction("red_wizard", "idle")).toBeNull()
    expect(resolveSfxKeyForAction("red_wizard", "walk")).toBeNull()
    expect(resolveSfxKeyForAction("red_wizard", "death")).toBeNull()
  })

  it("returns null for unknown hero", () => {
    expect(resolveSfxKeyForAction("unknown_hero", "spell:fireball")).toBeNull()
  })
})
