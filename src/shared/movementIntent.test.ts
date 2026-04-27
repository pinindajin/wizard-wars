import { describe, expect, it } from "vitest"

import { normalizedMoveFromWASD } from "./movementIntent"

describe("normalizedMoveFromWASD", () => {
  it("returns zero when no keys", () => {
    expect(normalizedMoveFromWASD({ up: false, down: false, left: false, right: false })).toEqual({
      dx: 0,
      dy: 0,
    })
  })

  it("normalizes diagonal movement", () => {
    const v = normalizedMoveFromWASD({ up: false, down: true, left: false, right: true })
    expect(v.dx).toBeCloseTo(Math.SQRT1_2, 5)
    expect(v.dy).toBeCloseTo(Math.SQRT1_2, 5)
  })
})
