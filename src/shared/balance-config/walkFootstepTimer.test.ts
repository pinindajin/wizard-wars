import { describe, expect, it } from "vitest"

import { getBehaviorAnimationConfig } from "./animationConfig"
import { WALK_FOOTSTEP_INTERVAL_MS } from "./audio"
import { DEFAULT_HERO_ID } from "./heroes"
import { tickWalkFootstepAccumulator } from "./walkFootstepTimer"

describe("WALK_FOOTSTEP_INTERVAL_MS", () => {
  it("equals half the configured walk duration for the default hero", () => {
    const walkMs = getBehaviorAnimationConfig(DEFAULT_HERO_ID, "walk").durationMs
    expect(WALK_FOOTSTEP_INTERVAL_MS).toBe(walkMs / 2)
  })
})

describe("tickWalkFootstepAccumulator", () => {
  it("returns zero accum and no fire when inactive", () => {
    expect(tickWalkFootstepAccumulator(400, 16, false, 750)).toEqual({
      nextAccumMs: 0,
      fireStep: false,
    })
  })

  it("accumulates without firing below interval", () => {
    expect(tickWalkFootstepAccumulator(100, 200, true, 750)).toEqual({
      nextAccumMs: 300,
      fireStep: false,
    })
  })

  it("fires one step and carries remainder when crossing interval", () => {
    expect(tickWalkFootstepAccumulator(700, 100, true, 750)).toEqual({
      nextAccumMs: 50,
      fireStep: true,
    })
  })

  it("clears when inactive after activity", () => {
    expect(tickWalkFootstepAccumulator(50, 16, false, 750)).toEqual({
      nextAccumMs: 0,
      fireStep: false,
    })
  })
})
