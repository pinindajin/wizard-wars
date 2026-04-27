import { describe, it, expect } from "vitest"
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_SPAWN_POINTS,
  SPAWN_POINT_COUNT,
  TILE_SIZE_PX,
  ARENA_COLS,
  ARENA_ROWS,
  ARENA_PROP_COLLIDERS,
  ARENA_NON_WALKABLE_COLLIDERS,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import { PLAYER_RADIUS_PX } from "@/shared/balance-config/combat"
import {
  ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID,
} from "@/shared/balance-config/arena-layout"

/**
 * Tests whether a player spawn circle overlaps a generated collider rectangle.
 *
 * @param x - Spawn center x.
 * @param y - Spawn center y.
 * @param rect - Collider rectangle.
 * @returns Whether the spawn circle overlaps the rectangle.
 */
function spawnOverlapsCollider(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.width))
  const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.height))
  const dx = x - nearestX
  const dy = y - nearestY
  return dx * dx + dy * dy < PLAYER_RADIUS_PX * PLAYER_RADIUS_PX
}

describe("arena constants", () => {
  it("exposes prop colliders from generated Tiled export (may be empty)", () => {
    expect(Array.isArray(ARENA_PROP_COLLIDERS)).toBe(true)
    for (const r of ARENA_PROP_COLLIDERS) {
      expect(r.width).toBeGreaterThan(0)
      expect(r.height).toBeGreaterThan(0)
    }
  })

  it("exposes editor-authored non-walkable colliders", () => {
    expect(ARENA_NON_WALKABLE_COLLIDERS.length).toBeGreaterThan(0)
    expect(ARENA_WORLD_COLLIDERS.length).toBe(
      ARENA_PROP_COLLIDERS.length + ARENA_NON_WALKABLE_COLLIDERS.length,
    )
    expect(
      ARENA_NON_WALKABLE_COLLIDERS.some(
        (rect) => rect.width >= TILE_SIZE_PX && rect.height >= TILE_SIZE_PX,
      ),
    ).toBe(true)
    expect(
      ARENA_NON_WALKABLE_COLLIDERS.some(
        (rect) =>
          rect.x % TILE_SIZE_PX === 0 &&
          rect.y % TILE_SIZE_PX === 0 &&
          rect.width % TILE_SIZE_PX === 0 &&
          rect.height % TILE_SIZE_PX === 0,
      ),
    ).toBe(true)
  })

  it("has generated dimensions at 64px per tile", () => {
    expect(TILE_SIZE_PX).toBe(64)
    expect(ARENA_COLS).toBeGreaterThan(0)
    expect(ARENA_ROWS).toBeGreaterThan(0)
    expect(ARENA_COLS * TILE_SIZE_PX).toBe(ARENA_WIDTH)
    expect(ARENA_ROWS * TILE_SIZE_PX).toBe(ARENA_HEIGHT)
  })

  it("has correct center coordinates", () => {
    expect(ARENA_CENTER_X).toBe(ARENA_WIDTH / 2)
    expect(ARENA_CENTER_Y).toBe(ARENA_HEIGHT / 2)
  })

  it("starts imported terrain after the 16 original terrain GIDs", () => {
    expect(ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID).toBe(17)
  })
})

describe("spawn points", () => {
  it("has 12 spawn points", () => {
    expect(ARENA_SPAWN_POINTS).toHaveLength(SPAWN_POINT_COUNT)
    expect(SPAWN_POINT_COUNT).toBe(12)
  })

  it("all spawn points are within arena bounds", () => {
    for (const sp of ARENA_SPAWN_POINTS) {
      expect(sp.x).toBeGreaterThan(0)
      expect(sp.x).toBeLessThan(ARENA_WIDTH)
      expect(sp.y).toBeGreaterThan(0)
      expect(sp.y).toBeLessThan(ARENA_HEIGHT)
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

  it("no spawn point overlaps editor-authored non-walkable colliders", () => {
    for (const sp of ARENA_SPAWN_POINTS) {
      for (const rect of ARENA_NON_WALKABLE_COLLIDERS) {
        expect(spawnOverlapsCollider(sp.x, sp.y, rect)).toBe(false)
      }
    }
  })
})
