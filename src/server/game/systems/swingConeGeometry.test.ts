import { describe, it, expect } from "vitest"

import { inSwingCone, normalizeAngleDiff } from "./swingConeGeometry"

describe("normalizeAngleDiff", () => {
  it("wraps large positive differences through 2π", () => {
    expect(normalizeAngleDiff(4 * Math.PI)).toBeCloseTo(0, 5)
    expect(normalizeAngleDiff(3 * Math.PI)).toBeCloseTo(Math.PI, 5)
  })

  it("wraps large negative differences through 2π", () => {
    expect(normalizeAngleDiff(-4 * Math.PI)).toBeCloseTo(0, 5)
    expect(normalizeAngleDiff(-3 * Math.PI)).toBeCloseTo(-Math.PI, 5)
  })

  it("leaves in-range values unchanged", () => {
    expect(normalizeAngleDiff(0.5)).toBeCloseTo(0.5)
    expect(normalizeAngleDiff(-1)).toBeCloseTo(-1)
  })
})

describe("inSwingCone", () => {
  it("returns false when beyond radius", () => {
    expect(inSwingCone(0, 0, 0, 100, 0, 50, 90)).toBe(false)
  })

  it("returns true for a point inside a forward-facing quarter cone", () => {
    expect(inSwingCone(0, 0, 0, 40, 0, 80, 90)).toBe(true)
  })
})
