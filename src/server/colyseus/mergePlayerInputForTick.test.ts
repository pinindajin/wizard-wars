import { describe, expect, it } from "vitest"

import { mergePlayerInputForTick } from "./mergePlayerInputForTick"
import type { PlayerInputPayload } from "@/shared/types"

const baseInput = (): PlayerInputPayload => ({
  up: true,
  down: false,
  left: false,
  right: false,
  abilitySlot: null,
  abilityTargetX: 100,
  abilityTargetY: 200,
  weaponPrimary: false,
  weaponSecondary: false,
  weaponTargetX: 100,
  weaponTargetY: 200,
  useQuickItemSlot: null,
  seq: 5,
})

describe("mergePlayerInputForTick", () => {
  it("returns latest unchanged when there is no pending ability", () => {
    const latest = baseInput()
    expect(mergePlayerInputForTick(latest, undefined)).toBe(latest)
  })

  it("overrides abilitySlot when pending is set (trailing null on latest)", () => {
    const latest: PlayerInputPayload = { ...baseInput(), abilitySlot: null }
    const out = mergePlayerInputForTick(latest, 0)
    expect(out.abilitySlot).toBe(0)
    expect(out.up).toBe(true)
    expect(out.seq).toBe(5)
  })

  it("applies last-wins pending (slot 2) over prior latest abilitySlot 0", () => {
    const latest: PlayerInputPayload = { ...baseInput(), abilitySlot: 0 }
    const out = mergePlayerInputForTick(latest, 2)
    expect(out.abilitySlot).toBe(2)
  })
})
