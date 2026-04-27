import { describe, expect, it } from "vitest"

import { computeAlphaOutlineSegments } from "./sprite-outline"

/**
 * Writes opaque RGBA into a flat buffer at (x, y).
 *
 * @param data - RGBA buffer.
 * @param width - Image width.
 * @param x - Column.
 * @param y - Row.
 */
function setOpaque(data: Uint8ClampedArray, width: number, x: number, y: number): void {
  const i = (y * width + x) * 4
  data[i] = 255
  data[i + 1] = 0
  data[i + 2] = 0
  data[i + 3] = 255
}

describe("computeAlphaOutlineSegments", () => {
  it("returns a closed 1px ring around a single center pixel on a 5×5 grid", () => {
    const w = 5
    const h = 5
    const data = new Uint8ClampedArray(w * h * 4)
    setOpaque(data, w, 2, 2)

    const segs = computeAlphaOutlineSegments(data, w, h, 8)
    // 4 sides × 1px each for an isolated pixel → 4 segments
    expect(segs.length).toBe(4)
    const horiz = segs.filter((s) => s.y1 === s.y2)
    const vert = segs.filter((s) => s.x1 === s.x2)
    expect(horiz.length).toBe(2)
    expect(vert.length).toBe(2)
  })

  it("returns no segments for an all-transparent buffer", () => {
    const w = 3
    const h = 3
    const data = new Uint8ClampedArray(w * h * 4)
    expect(computeAlphaOutlineSegments(data, w, h).length).toBe(0)
  })

  it("treats low-alpha pixels as transparent when threshold is 128", () => {
    const w = 3
    const h = 3
    const data = new Uint8ClampedArray(w * h * 4)
    const i = (1 * w + 1) * 4
    data[i + 3] = 10
    expect(computeAlphaOutlineSegments(data, w, h, 128).length).toBe(0)
  })

  it("outlines a 2×1 horizontal bar with expected bounding edges", () => {
    const w = 4
    const h = 3
    const data = new Uint8ClampedArray(w * h * 4)
    setOpaque(data, w, 1, 1)
    setOpaque(data, w, 2, 1)

    const segs = computeAlphaOutlineSegments(data, w, h, 8)
    // Top and bottom full width 2 + left vertical + right vertical for bar at y=1 x=1..2
    const xs = new Set<number>()
    for (const s of segs) {
      xs.add(s.x1)
      xs.add(s.x2)
    }
    expect(Math.min(...xs)).toBeLessThanOrEqual(1)
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(3)
  })
})
