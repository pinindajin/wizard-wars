import { describe, it, expect } from "vitest"
import {
  ARENA_WIDTH, ARENA_HEIGHT, ARENA_CENTER_X, ARENA_CENTER_Y,
  ARENA_SPAWN_POINTS, SPAWN_POINT_COUNT, ARENA_SPAWN_RING_RADIUS_PX,
  TILE_SIZE_PX, ARENA_COLS, ARENA_ROWS,
} from "@/shared/balance-config/arena"

describe("arena constants", () => {
  it("has correct dimensions (21x12 x 64px)", () => {
    expect(ARENA_WIDTH).toBe(1344)
    expect(ARENA_HEIGHT).toBe(768)
    expect(TILE_SIZE_PX).toBe(64)
    expect(ARENA_COLS).toBe(21)
    expect(ARENA_ROWS).toBe(12)
    expect(ARENA_COLS * TILE_SIZE_PX).toBe(ARENA_WIDTH)
    expect(ARENA_ROWS * TILE_SIZE_PX).toBe(ARENA_HEIGHT)
  })

  it("has correct center coordinates", () => {
    expect(ARENA_CENTER_X).toBe(672)
    expect(ARENA_CENTER_Y).toBe(384)
    expect(ARENA_CENTER_X).toBe(ARENA_WIDTH / 2)
    expect(ARENA_CENTER_Y).toBe(ARENA_HEIGHT / 2)
  })
})

describe("spawn points", () => {
  it("has 12 spawn points", () => {
    expect(ARENA_SPAWN_POINTS).toHaveLength(SPAWN_POINT_COUNT)
    expect(SPAWN_POINT_COUNT).toBe(12)
  })

  it("all spawn points are on the ring (radius ~300)", () => {
    for (const sp of ARENA_SPAWN_POINTS) {
      const dx = sp.x - ARENA_CENTER_X
      const dy = sp.y - ARENA_CENTER_Y
      const dist = Math.sqrt(dx * dx + dy * dy)
      // Allow ±1 for rounding
      expect(dist).toBeCloseTo(ARENA_SPAWN_RING_RADIUS_PX, 0)
    }
  })

  it("all spawn points are within arena bounds", () => {
    for (const sp of ARENA_SPAWN_POINTS) {
      expect(sp.x).toBeGreaterThan(0)
      expect(sp.x).toBeLessThan(ARENA_WIDTH)
      expect(sp.y).toBeGreaterThan(0)
      expect(sp.y).toBeLessThan(ARENA_HEIGHT)
    }
  })

  it("spawn points are evenly spaced 30° apart", () => {
    const angles = ARENA_SPAWN_POINTS.map((sp) =>
      Math.atan2(sp.y - ARENA_CENTER_Y, sp.x - ARENA_CENTER_X) * (180 / Math.PI),
    )
    // Sort angles and check differences are ~30°
    const sorted = [...angles].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      const diff = sorted[i] - sorted[i - 1]
      expect(diff).toBeCloseTo(30, 0)
    }
  })

  it("no two spawn points overlap (all distinct positions)", () => {
    const seen = new Set<string>()
    for (const sp of ARENA_SPAWN_POINTS) {
      const key = `${sp.x},${sp.y}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})
