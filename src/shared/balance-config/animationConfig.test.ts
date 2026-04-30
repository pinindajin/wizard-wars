import { describe, expect, it } from "vitest"

import {
  ANIMATION_CONFIG,
  animationConfigSchema,
  frameRateForDuration,
  getAnimationActionConfig,
  getBehaviorAnimationConfig,
  getAnimationToolActions,
  getPrimaryAttackAnimationConfig,
  getPrimaryAttackAnimationConfigByAttackId,
  getSpellAnimationConfig,
  msToFrameIndex,
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

  it("rejects missing during ms, after ms, and overlong dangerous windows", () => {
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

  it("builds one shared action list without direction variants", () => {
    const actions = getAnimationToolActions("red_wizard")
    expect(actions.map((action) => action.id)).toContain("primary:red_wizard_cleaver")
    expect(actions.some((action) => action.id.includes("south"))).toBe(false)
    expect(getAnimationToolActions("unknown_hero")[0]!.id).toBe("idle")
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
