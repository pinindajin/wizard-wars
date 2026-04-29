import { describe, expect, it } from "vitest"

import {
  CHARACTER_HITBOX_DOWN_PX,
  CHARACTER_HITBOX_LEFT_PX,
  CHARACTER_HITBOX_RIGHT_PX,
  CHARACTER_HITBOX_UP_PX,
} from "@/shared/balance-config/combat"
import {
  capsuleIntersectsRect,
  characterHitboxForCenter,
  circleIntersectsRect,
  normalizeAngleDiff,
  pointInSwingCone,
  swingConeIntersectsRect,
} from "./characterHitbox"

describe("characterHitboxForCenter", () => {
  it("builds the asymmetric combat hitbox from the sim anchor", () => {
    expect(characterHitboxForCenter(100, 100)).toEqual({
      x: 100 - CHARACTER_HITBOX_LEFT_PX,
      y: 100 - CHARACTER_HITBOX_UP_PX,
      width: CHARACTER_HITBOX_LEFT_PX + CHARACTER_HITBOX_RIGHT_PX,
      height: CHARACTER_HITBOX_UP_PX + CHARACTER_HITBOX_DOWN_PX,
    })
  })
})

describe("circleIntersectsRect", () => {
  const rect = characterHitboxForCenter(100, 100)

  it("counts exact circle-to-hitbox touches as hits", () => {
    expect(circleIntersectsRect(rect.x - 8, 100, 8, rect)).toBe(true)
  })

  it("rejects circles just outside the hitbox", () => {
    expect(circleIntersectsRect(rect.x - 8.01, 100, 8, rect)).toBe(false)
  })
})

describe("capsuleIntersectsRect", () => {
  const rect = characterHitboxForCenter(100, 100)

  it("hits when a capsule endpoint starts inside the hitbox", () => {
    expect(capsuleIntersectsRect(100, 100, 200, 100, 0, rect)).toBe(true)
  })

  it("hits when a zero-radius segment crosses the hitbox", () => {
    expect(capsuleIntersectsRect(40, 100, 160, 100, 0, rect)).toBe(true)
  })

  it("hits when the capsule radius reaches the hitbox edge", () => {
    expect(capsuleIntersectsRect(40, 40, 160, 40, 20, rect)).toBe(true)
  })

  it("handles zero-length capsules", () => {
    expect(capsuleIntersectsRect(100, 55, 100, 55, 5, rect)).toBe(true)
    expect(capsuleIntersectsRect(100, 54.99, 100, 54.99, 5, rect)).toBe(false)
  })

  it("rejects colinear zero-radius segments that stop before or after an edge", () => {
    expect(capsuleIntersectsRect(85, 0, 85, 50, 0, rect)).toBe(false)
    expect(capsuleIntersectsRect(85, 120, 85, 130, 0, rect)).toBe(false)
  })

  it("misses when the capsule is outside the hitbox", () => {
    expect(capsuleIntersectsRect(40, 35, 160, 35, 20, rect)).toBe(false)
  })
})

describe("pointInSwingCone", () => {
  it("wraps angle differences and respects radius/arc limits", () => {
    expect(normalizeAngleDiff(3 * Math.PI)).toBeCloseTo(Math.PI)
    expect(normalizeAngleDiff(-3 * Math.PI)).toBeCloseTo(-Math.PI)
    expect(pointInSwingCone(0, 0, 0, 10, 0, 20, 90)).toBe(true)
    expect(pointInSwingCone(0, 0, 0, 30, 0, 20, 90)).toBe(false)
    expect(pointInSwingCone(0, 0, 0, 10, 20, 30, 45)).toBe(false)
  })
})

describe("swingConeIntersectsRect", () => {
  const rect = characterHitboxForCenter(100, 100)

  it("hits when the swing origin starts inside the hitbox", () => {
    expect(swingConeIntersectsRect(100, 100, Math.PI, 30, 60, rect)).toBe(true)
  })

  it("hits when a target hitbox corner enters the swing cone", () => {
    expect(swingConeIntersectsRect(0, 100, 0, 90, 90, rect)).toBe(true)
  })

  it("hits when a cone boundary crosses the hitbox", () => {
    expect(
      swingConeIntersectsRect(0, 0, 0, 120, 90, {
        x: 70,
        y: 70,
        width: 20,
        height: 20,
      }),
    ).toBe(true)
  })

  it("hits when the cone arc crosses a hitbox edge", () => {
    expect(
      swingConeIntersectsRect(0, 0, 0, 100, 60, {
        x: 100,
        y: -10,
        width: 2,
        height: 20,
      }),
    ).toBe(true)
  })

  it("hits when the cone center ray crosses the hitbox", () => {
    expect(
      swingConeIntersectsRect(0, 0, 0, 80, 10, {
        x: 40,
        y: -4,
        width: 10,
        height: 8,
      }),
    ).toBe(true)
  })

  it("misses when the hitbox is outside the swing cone", () => {
    expect(swingConeIntersectsRect(0, 100, Math.PI, 90, 90, rect)).toBe(false)
  })
})
