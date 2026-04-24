import { describe, it, expect } from "vitest"

import { animUsesMouseAim } from "@/shared/playerAnimAim"

describe("animUsesMouseAim", () => {
  it("returns true for aim-driven animation states", () => {
    expect(animUsesMouseAim("axe_swing")).toBe(true)
    expect(animUsesMouseAim("light_cast")).toBe(true)
    expect(animUsesMouseAim("heavy_cast")).toBe(true)
  })

  it("returns false for body-driven animation states", () => {
    expect(animUsesMouseAim("idle")).toBe(false)
    expect(animUsesMouseAim("walk")).toBe(false)
    expect(animUsesMouseAim("dying")).toBe(false)
    expect(animUsesMouseAim("dead")).toBe(false)
  })
})
