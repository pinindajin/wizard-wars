import { describe, expect, it } from "vitest"

import {
  rectCoverArea,
  rectCoverContainsPoint,
  simplifyRectCover,
  type RectCover,
} from "./rect-cover-simplification"

describe("simplifyRectCover", () => {
  it("returns an empty cover when all rectangles are empty or invalid", () => {
    expect(
      simplifyRectCover([
        { x: 0, y: 0, width: 0, height: 4 },
        { x: 0, y: 0, width: 4, height: -1 },
        { x: Number.NaN, y: 0, width: 4, height: 4 },
      ]),
    ).toEqual([])
  })

  it("merges overlapping and adjacent rectangles while preserving half-open coverage", () => {
    const original: RectCover[] = [
      { x: 0, y: 0, width: 8, height: 4 },
      { x: 8, y: 0, width: 4, height: 4 },
      { x: 4, y: 4, width: 8, height: 4 },
      { x: 0, y: 8, width: 12, height: 4 },
    ]

    const simplified = simplifyRectCover(original)

    expect(simplified).toEqual([
      { x: 0, y: 0, width: 12, height: 4 },
      { x: 4, y: 4, width: 8, height: 4 },
      { x: 0, y: 8, width: 12, height: 4 },
    ])
    assertExactCoverParity(original, simplified)
    expect(rectCoverArea(simplified)).toBe(128)
  })

  it("merges vertically only when row runs have identical x and width", () => {
    const simplified = simplifyRectCover([
      { x: 0, y: 0, width: 4, height: 4 },
      { x: 0, y: 4, width: 4, height: 4 },
      { x: 4, y: 8, width: 4, height: 4 },
    ])

    expect(simplified).toEqual([
      { x: 0, y: 0, width: 4, height: 8 },
      { x: 4, y: 8, width: 4, height: 4 },
    ])
  })

  it("uses half-open point semantics on rectangle edges", () => {
    const cover = [{ x: 10, y: 20, width: 5, height: 6 }]

    expect(rectCoverContainsPoint(cover, 10, 20)).toBe(true)
    expect(rectCoverContainsPoint(cover, 14.999, 25.999)).toBe(true)
    expect(rectCoverContainsPoint(cover, 15, 20)).toBe(false)
    expect(rectCoverContainsPoint(cover, 10, 26)).toBe(false)
  })

  it("keeps deterministic ordering for rectangles with matching y and x sort ties", () => {
    const simplified = simplifyRectCover([
      { x: 10, y: 0, width: 5, height: 5 },
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 0, y: 5, width: 5, height: 5 },
    ])

    expect(simplified).toEqual([
      { x: 0, y: 0, width: 5, height: 10 },
      { x: 10, y: 0, width: 5, height: 5 },
    ])
  })
})

/**
 * Checks exact coverage by sampling every cell induced by all rectangle edges.
 *
 * @param original - Original half-open cover.
 * @param simplified - Simplified half-open cover.
 */
function assertExactCoverParity(
  original: readonly RectCover[],
  simplified: readonly RectCover[],
): void {
  const xs = uniqueEdges(original, simplified, "x", "width")
  const ys = uniqueEdges(original, simplified, "y", "height")
  for (let yi = 0; yi < ys.length - 1; yi++) {
    for (let xi = 0; xi < xs.length - 1; xi++) {
      const x = (xs[xi]! + xs[xi + 1]!) / 2
      const y = (ys[yi]! + ys[yi + 1]!) / 2
      expect(rectCoverContainsPoint(simplified, x, y)).toBe(
        rectCoverContainsPoint(original, x, y),
      )
    }
  }
}

/**
 * Collects sorted unique rectangle edges for parity sampling.
 *
 * @param left - First cover.
 * @param right - Second cover.
 * @param originKey - Rectangle origin key for the axis.
 * @param sizeKey - Rectangle size key for the axis.
 * @returns Sorted edge coordinates.
 */
function uniqueEdges(
  left: readonly RectCover[],
  right: readonly RectCover[],
  originKey: "x" | "y",
  sizeKey: "width" | "height",
): number[] {
  const values = new Set<number>()
  for (const rect of [...left, ...right]) {
    values.add(rect[originKey])
    values.add(rect[originKey] + rect[sizeKey])
  }
  return [...values].sort((a, b) => a - b)
}
