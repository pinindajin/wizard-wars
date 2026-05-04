import { describe, expect, it } from "vitest"

import {
  ANIMATION_CONFIG,
  animationConfigSchema,
  frameRateForDuration,
  frameStartMsList,
  getAnimationActionConfig,
  getBehaviorAnimationConfig,
  getAnimationToolActions,
  getPrimaryAttackAnimationConfig,
  getPrimaryAttackAnimationConfigByAttackId,
  getSpellAnimationConfig,
  megasheetClipForAnimationActionKey,
  msToFrameIndex,
  msToFrameIndexForAction,
  msToFrameIndexFromDurations,
  msToTickOffset,
  parseAnimationConfig,
  parseAnimationToolSave,
} from "./animationConfig"
import { TICK_MS } from "./rendering"

describe("animation config", () => {
  it("parses the canonical config", () => {
    expect(parseAnimationConfig(ANIMATION_CONFIG).schemaVersion).toBe(1)
  })

  it("rejects direction-specific timing keys", () => {
    const bad = structuredClone(ANIMATION_CONFIG)
    bad.heroes.red_wizard.actions["idle:south"] = {
      type: "behavior",
      durationMs: 999,
    }
    expect(animationConfigSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects invalid spell and dangerous timing", () => {
    const badSpell = structuredClone(ANIMATION_CONFIG)
    badSpell.heroes.red_wizard.actions["spell:fireball"] = {
      type: "spell",
      durationMs: 500,
      effectTiming: "during",
      effectAtMs: 500,
    }
    expect(animationConfigSchema.safeParse(badSpell).success).toBe(false)

    const badAttack = structuredClone(ANIMATION_CONFIG)
    badAttack.heroes.red_wizard.actions["primary:red_wizard_cleaver"] = {
      type: "primaryAttack",
      durationMs: 100,
      dangerousWindowStartMs: 90,
      dangerousWindowEndMs: 50,
    }
    expect(animationConfigSchema.safeParse(badAttack).success).toBe(false)
  })

  it("accepts before spell timing without an effect ms", () => {
    const before = structuredClone(ANIMATION_CONFIG)
    before.heroes.red_wizard.actions["spell:fireball"] = {
      type: "spell",
      durationMs: 500,
      effectTiming: "before",
    }
    expect(animationConfigSchema.safeParse(before).success).toBe(true)
  })

  it("rejects missing during ms, before/after ms, and overlong dangerous windows", () => {
    const missingDuring = structuredClone(ANIMATION_CONFIG)
    missingDuring.heroes.red_wizard.actions["spell:fireball"] = {
      type: "spell",
      durationMs: 500,
      effectTiming: "during",
    }
    expect(animationConfigSchema.safeParse(missingDuring).success).toBe(false)

    const afterWithMs = structuredClone(ANIMATION_CONFIG)
    afterWithMs.heroes.red_wizard.actions["spell:fireball"] = {
      type: "spell",
      durationMs: 500,
      effectTiming: "after",
      effectAtMs: 100,
    }
    expect(animationConfigSchema.safeParse(afterWithMs).success).toBe(false)

    const beforeWithMs = structuredClone(ANIMATION_CONFIG)
    beforeWithMs.heroes.red_wizard.actions["spell:fireball"] = {
      type: "spell",
      durationMs: 500,
      effectTiming: "before",
      effectAtMs: 100,
    }
    expect(animationConfigSchema.safeParse(beforeWithMs).success).toBe(false)

    const tooLongAttack = structuredClone(ANIMATION_CONFIG)
    tooLongAttack.heroes.red_wizard.actions["primary:red_wizard_cleaver"] = {
      type: "primaryAttack",
      durationMs: 100,
      dangerousWindowStartMs: 50,
      dangerousWindowEndMs: 101,
    }
    expect(animationConfigSchema.safeParse(tooLongAttack).success).toBe(false)
  })

  it("rejects unknown heroes and missing required hero/actions", () => {
    const unknownHero = structuredClone(ANIMATION_CONFIG)
    unknownHero.heroes.ghost = { actions: {} }
    expect(animationConfigSchema.safeParse(unknownHero).success).toBe(false)

    const missingHero = structuredClone(ANIMATION_CONFIG)
    delete missingHero.heroes.ranger
    expect(animationConfigSchema.safeParse(missingHero).success).toBe(false)

    const missingAction = structuredClone(ANIMATION_CONFIG)
    delete missingAction.heroes.red_wizard.actions.walk
    expect(animationConfigSchema.safeParse(missingAction).success).toBe(false)
  })

  it("maps ms to ticks and frames deterministically", () => {
    expect(msToTickOffset(TICK_MS + 0.1)).toBe(2)
    expect(msToFrameIndex(250, 1000, 4)).toBe(1)
    expect(msToFrameIndex(10, 0, 4)).toBe(0)
    expect(msToFrameIndex(10, 1000, 0)).toBe(0)
    expect(frameRateForDuration(10, 500)).toBe(20)
    expect(frameRateForDuration(0, 500)).toBe(1)
    expect(frameRateForDuration(10, 0)).toBe(1)
  })

  it("rejects frameDurationsMs when length mismatches clip frame count", () => {
    const bad = structuredClone(ANIMATION_CONFIG)
    bad.heroes.red_wizard.actions["primary:red_wizard_cleaver"] = {
      type: "primaryAttack",
      durationMs: 540,
      dangerousWindowStartMs: 300,
      dangerousWindowEndMs: 540,
      frameDurationsMs: [100, 100, 100],
    }
    expect(animationConfigSchema.safeParse(bad).success).toBe(false)
  })

  it("rejects frameDurationsMs when sum does not match durationMs", () => {
    const bad = structuredClone(ANIMATION_CONFIG)
    bad.heroes.red_wizard.actions["primary:red_wizard_cleaver"] = {
      type: "primaryAttack",
      durationMs: 540,
      dangerousWindowStartMs: 300,
      dangerousWindowEndMs: 540,
      frameDurationsMs: [100, 100, 100, 60, 60, 60, 80],
    }
    expect(animationConfigSchema.safeParse(bad).success).toBe(false)
  })

  it("accepts optional frameDurationsMs when length and sum match", () => {
    const good = structuredClone(ANIMATION_CONFIG)
    good.heroes.red_wizard.actions["primary:red_wizard_cleaver"] = {
      type: "primaryAttack",
      durationMs: 540,
      dangerousWindowStartMs: 300,
      dangerousWindowEndMs: 540,
      frameDurationsMs: [100, 100, 100, 60, 60, 60, 60],
    }
    expect(animationConfigSchema.safeParse(good).success).toBe(true)
  })

  it("maps ms to frame index from per-frame durations at boundaries", () => {
    const fd = [100, 100, 100, 60, 60, 60, 60] as const
    expect(msToFrameIndexFromDurations(0, fd)).toBe(0)
    expect(msToFrameIndexFromDurations(99, fd)).toBe(0)
    expect(msToFrameIndexFromDurations(100, fd)).toBe(1)
    expect(msToFrameIndexFromDurations(299, fd)).toBe(2)
    expect(msToFrameIndexFromDurations(300, fd)).toBe(3)
    expect(msToFrameIndexFromDurations(539, fd)).toBe(6)
    expect(msToFrameIndexFromDurations(900, fd)).toBe(6)
    expect(msToFrameIndexFromDurations(10, [])).toBe(0)
  })

  it("msToFrameIndexForAction uses per-frame list only when length matches frame count", () => {
    const fd = [100, 100, 100, 60, 60, 60, 60] as const
    expect(msToFrameIndexForAction(300, 540, 7, fd)).toBe(3)
    expect(msToFrameIndexForAction(300, 540, 7, [100, 100])).toBe(
      msToFrameIndex(300, 540, 7),
    )
    expect(msToFrameIndexForAction(100, 1000, 4, undefined)).toBe(0)
    expect(msToFrameIndexForAction(1, 500, 0, [1])).toBe(0)
  })

  it("resolves megasheet clip for spell, primary, and behavior action keys", () => {
    expect(megasheetClipForAnimationActionKey("idle")).toBe("breathing_idle")
    expect(megasheetClipForAnimationActionKey("walk")).toBe("walk")
    expect(megasheetClipForAnimationActionKey("death")).toBe("death")
    expect(megasheetClipForAnimationActionKey("stumble")).toBe("stumble")
    expect(megasheetClipForAnimationActionKey("spell:fireball")).toBe("light_spell_cast")
    expect(megasheetClipForAnimationActionKey("spell:lightning_bolt")).toBe("heavy_spell_cast")
    expect(megasheetClipForAnimationActionKey("primary:red_wizard_cleaver")).toBe(
      "summoned_axe_swing",
    )
    expect(() => megasheetClipForAnimationActionKey("not-a-real-key")).toThrow(
      /Unknown animation action key/,
    )
  })

  it("frameStartMsList returns empty for non-positive frame count", () => {
    expect(frameStartMsList(1000, 0, undefined)).toEqual([])
    expect(frameStartMsList(1000, -1, undefined)).toEqual([])
  })

  it("frameStartMsList uses per-frame durations when length matches frame count", () => {
    expect(frameStartMsList(400, 4, [100, 100, 100, 100])).toEqual([0, 100, 200, 300])
  })

  it("frameStartMsList falls back to uniform splits when durations length mismatches", () => {
    expect(frameStartMsList(100, 4, [50, 50])).toEqual([0, 25, 50, 75])
    expect(frameStartMsList(100, 4, [])).toEqual([0, 25, 50, 75])
  })

  it("builds one shared action list without direction variants", () => {
    const actions = getAnimationToolActions("red_wizard")
    expect(actions.map((action) => action.id)).toContain("primary:red_wizard_cleaver")
    expect(actions.some((action) => action.id.includes("south"))).toBe(false)
    expect(getAnimationToolActions("unknown_hero")[0]!.id).toBe("idle")
    expect(
      getAnimationToolActions("ranger", {
        ...ANIMATION_CONFIG,
        heroes: {
          red_wizard: ANIMATION_CONFIG.heroes.red_wizard,
        },
      } as never)[0]!.config,
    ).toBe(ANIMATION_CONFIG.heroes.red_wizard.actions.idle)
  })

  it("parses tool saves and exposes typed config helpers", () => {
    expect(
      parseAnimationToolSave({
        schemaVersion: 1,
        savedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        config: ANIMATION_CONFIG,
      }).config,
    ).toEqual(ANIMATION_CONFIG)

    expect(getAnimationActionConfig("missing", "walk").type).toBe("behavior")
    expect(getBehaviorAnimationConfig("red_wizard", "walk").durationMs).toBeGreaterThan(0)
    expect(getSpellAnimationConfig("red_wizard", "fireball").durationMs).toBe(500)
    expect(
      getPrimaryAttackAnimationConfig("red_wizard", "red_wizard_cleaver").durationMs,
    ).toBeGreaterThan(0)
    expect(
      getPrimaryAttackAnimationConfigByAttackId("not_real" as never).durationMs,
    ).toBeGreaterThan(0)
  })

  it("falls back to canonical default config when the injected config lacks an action", () => {
    expect(
      getAnimationActionConfig("missing", "walk", {
        schemaVersion: 1,
        heroes: {
          red_wizard: { actions: {} },
        },
      } as never).type,
    ).toBe("behavior")

    expect(() =>
      getAnimationActionConfig("missing", "spell:not_real", {
        schemaVersion: 1,
        heroes: {
          red_wizard: { actions: {} },
        },
      } as never),
    ).toThrow(/Missing animation action/)
  })

  it("throws when a helper is asked for the wrong action kind", () => {
    const wrongSpell = structuredClone(ANIMATION_CONFIG)
    wrongSpell.heroes.red_wizard.actions["spell:fireball"] = {
      type: "behavior",
      durationMs: 500,
    }
    const wrongPrimary = structuredClone(ANIMATION_CONFIG)
    wrongPrimary.heroes.red_wizard.actions["primary:red_wizard_cleaver"] = {
      type: "behavior",
      durationMs: 500,
    }

    expect(() => getBehaviorAnimationConfig("red_wizard", "spell:fireball" as never)).toThrow(
      /not behavior/,
    )
    expect(() => getSpellAnimationConfig("red_wizard", "fireball", wrongSpell)).toThrow(/not spell/)
    expect(() =>
      getPrimaryAttackAnimationConfig("red_wizard", "red_wizard_cleaver", wrongPrimary),
    ).toThrow(/not primary attack/)
  })
})
