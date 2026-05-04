import { describe, expect, it } from "vitest"

import {
  DEFAULT_MINIMAP_CORNER,
  MINIMAP_CORNERS,
  isMinimapCorner,
  parseMinimapCorner,
} from "./minimapCorner"

describe("minimap corner settings", () => {
  it("accepts all supported corners", () => {
    for (const corner of MINIMAP_CORNERS) {
      expect(isMinimapCorner(corner)).toBe(true)
      expect(parseMinimapCorner(corner)).toBe(corner)
    }
  })

  it("falls back to the default corner for invalid values", () => {
    expect(isMinimapCorner("center")).toBe(false)
    expect(parseMinimapCorner("center")).toBe(DEFAULT_MINIMAP_CORNER)
    expect(parseMinimapCorner(null)).toBe(DEFAULT_MINIMAP_CORNER)
  })
})
