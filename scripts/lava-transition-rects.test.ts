import { describe, expect, it } from "vitest"

import {
  lavaTransitionRectsFromNonWalkableAndLava,
  rectIntersectionArea,
} from "./lava-transition-rects"

describe("lavaTransitionRectsFromNonWalkableAndLava", () => {
  it("computes rectangle intersection area", () => {
    expect(
      rectIntersectionArea(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 5, width: 10, height: 10 },
      ),
    ).toBe(25)
    expect(
      rectIntersectionArea(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 20, width: 4, height: 4 },
      ),
    ).toBe(0)
  })

  it("keeps non-walkable that straddles lava-cliff boundary", () => {
    const lava = [{ x: 64, y: 64, width: 64, height: 64 }]
    const strip = { x: 120, y: 64, width: 32, height: 64 }
    expect(lavaTransitionRectsFromNonWalkableAndLava([strip], lava)).toEqual([strip])
  })

  it("drops non-walkable almost fully inside lava", () => {
    const lava = [{ x: 0, y: 0, width: 100, height: 100 }]
    const interior = { x: 10, y: 10, width: 80, height: 80 }
    expect(lavaTransitionRectsFromNonWalkableAndLava([interior], lava)).toEqual([])
  })
})
