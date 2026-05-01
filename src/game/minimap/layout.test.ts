import { describe, expect, it } from "vitest"

import { computeMinimapViewport } from "./layout"

const BASE = {
  canvasWidth: 1344,
  canvasHeight: 768,
  arenaWidth: 4224,
  arenaHeight: 3392,
} as const

describe("computeMinimapViewport", () => {
  it("anchors compact minimap to each requested corner", () => {
    expect(computeMinimapViewport({ ...BASE, corner: "top_left", mode: "compact" })).toMatchObject({
      x: 18,
      y: 18,
      width: 208,
    })
    expect(computeMinimapViewport({ ...BASE, corner: "top_right", mode: "compact" }).x).toBe(1118)
    expect(computeMinimapViewport({ ...BASE, corner: "bottom_left", mode: "compact" }).y).toBe(583)
    expect(computeMinimapViewport({ ...BASE, corner: "bottom_right", mode: "compact" })).toMatchObject({
      x: 1118,
      y: 583,
    })
  })

  it("centers expanded minimap and preserves arena aspect", () => {
    const viewport = computeMinimapViewport({
      ...BASE,
      corner: "top_left",
      mode: "expanded",
    })

    expect(viewport).toEqual({ x: 337, y: 115, width: 670, height: 538 })
  })
})
