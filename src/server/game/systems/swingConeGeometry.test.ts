import { describe, it, expect } from "vitest"

import {
  inSwingCone,
  normalizeAngleDiff,
  swingConeIntersectsCharacterHitbox,
} from "./swingConeGeometry"

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

describe("swingConeIntersectsCharacterHitbox at arcDeg=180 (half-circle hurtbox)", () => {
  /** Half-circle hurtbox: 45px radius, 180° arc, facing east (0 rad). */
  const RADIUS = 45
  const ARC = 180

  it("hits a target hitbox in front of attacker (forward of half-plane)", () => {
    const rect = { x: 20, y: -10, width: 20, height: 20 }
    expect(swingConeIntersectsCharacterHitbox(0, 0, 0, RADIUS, ARC, rect)).toBe(true)
  })

  it("misses a target whose hitbox is fully behind the attacker (other side of half-plane)", () => {
    const rect = { x: -50, y: -10, width: 20, height: 20 }
    expect(swingConeIntersectsCharacterHitbox(0, 0, 0, RADIUS, ARC, rect)).toBe(false)
  })

  it("misses a target whose hitbox is forward but beyond radius", () => {
    const rect = { x: 60, y: -10, width: 20, height: 20 }
    expect(swingConeIntersectsCharacterHitbox(0, 0, 0, RADIUS, ARC, rect)).toBe(false)
  })

  it("hits a target whose hitbox straddles the diameter line on the forward side", () => {
    const rect = { x: -5, y: 0, width: 10, height: 30 }
    expect(swingConeIntersectsCharacterHitbox(0, 0, Math.PI / 2, RADIUS, ARC, rect)).toBe(true)
  })
})
