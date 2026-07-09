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
  ARENA_LAVA_COLLIDERS,
  ARENA_CLIFF_COLLIDERS,
  ARENA_NON_HAZARD_COLLIDERS,
  isArenaNonHazardCollider,
} from "@/shared/balance-config/arena"
import {
  PLAYER_WORLD_COLLISION_OFFSET_Y_PX,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
  PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
} from "@/shared/balance-config/combat"
import {
  ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID,
} from "@/shared/balance-config/arena-layout"
import { terrainStateAtPosition } from "@/shared/collision/terrainHazards"
import { canOccupyWorldPosition } from "@/shared/collision/worldCollision"

/**
 * Tests whether a player spawn oval overlaps a generated collider rectangle.
 *
 * @param x - Spawn center x.
 * @param y - Spawn center y.
 * @param rect - Collider rectangle.
 * @returns Whether the spawn oval overlaps the rectangle.
 */
function spawnOverlapsCollider(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.width))
  const ellipseCenterY = y + PLAYER_WORLD_COLLISION_OFFSET_Y_PX
  const nearestY = Math.max(rect.y, Math.min(ellipseCenterY, rect.y + rect.height))
  const dx = (x - nearestX) / PLAYER_WORLD_COLLISION_RADIUS_X_PX
  const dy = (ellipseCenterY - nearestY) / PLAYER_WORLD_COLLISION_RADIUS_Y_PX
  return dx * dx + dy * dy < 1
}

function pointInRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

function pointInRects(
  x: number,
  y: number,
  rects: readonly { x: number; y: number; width: number; height: number }[],
): boolean {
  return rects.some((rect) => pointInRect(x, y, rect))
}

describe("arena constants", () => {
  it("exposes native prop colliders from generated editor export", () => {
    expect(Array.isArray(ARENA_PROP_COLLIDERS)).toBe(true)
    expect(ARENA_PROP_COLLIDERS.length).toBeGreaterThan(0)
    for (const r of ARENA_PROP_COLLIDERS) {
      expect(r.width).toBeGreaterThan(0)
      expect(r.height).toBeGreaterThan(0)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(ARENA_WIDTH)
      expect(r.y + r.height).toBeLessThanOrEqual(ARENA_HEIGHT)
    }
  })

  it("exposes editor-authored non-walkable colliders", () => {
    expect(ARENA_NON_WALKABLE_COLLIDERS.length).toBeGreaterThan(0)
    expect(ARENA_WORLD_COLLIDERS.length).toBe(
      ARENA_PROP_COLLIDERS.length + ARENA_NON_HAZARD_COLLIDERS.length + ARENA_CLIFF_COLLIDERS.length,
    )
    expect(ARENA_WORLD_COLLIDERS).toEqual(ARENA_PROP_COLLIDERS)
    expect(ARENA_NON_WALKABLE_COLLIDERS).toEqual(ARENA_LAVA_COLLIDERS)
    for (const rect of ARENA_NON_WALKABLE_COLLIDERS) {
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.height).toBeGreaterThan(0)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(ARENA_WIDTH)
      expect(rect.y + rect.height).toBeLessThanOrEqual(ARENA_HEIGHT)
    }
  })

  it("classifies non-hazard terrain by lava and cliff overlap", () => {
    const rect = { x: 10, y: 10, width: 20, height: 20 }
    const overlapping = { x: 0, y: 0, width: 24, height: 24 }
    const separate = { x: 100, y: 100, width: 20, height: 20 }

    expect(isArenaNonHazardCollider(rect, [overlapping], [])).toBe(false)
    expect(isArenaNonHazardCollider(rect, [separate], [overlapping])).toBe(false)
    expect(isArenaNonHazardCollider(rect, [separate], [separate])).toBe(true)
  })

  it("exposes lava regions and no native cliff regions", () => {
    expect(ARENA_LAVA_COLLIDERS.length).toBeGreaterThan(0)
    expect(ARENA_CLIFF_COLLIDERS).toEqual([])
    for (const rect of ARENA_LAVA_COLLIDERS) {
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.height).toBeGreaterThan(0)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(ARENA_WIDTH)
      expect(rect.y + rect.height).toBeLessThanOrEqual(ARENA_HEIGHT)
    }
  })

  it("has no-cliff lava arena dimensions while retaining 64px broadphase cells", () => {
    expect(TILE_SIZE_PX).toBe(64)
    expect(ARENA_WIDTH).toBe(2112)
    expect(ARENA_HEIGHT).toBe(1696)
    expect(ARENA_COLS).toBe(33)
    expect(ARENA_ROWS).toBe(27)
  })

  it("has correct center coordinates", () => {
    expect(ARENA_CENTER_X).toBe(ARENA_WIDTH / 2)
    expect(ARENA_CENTER_Y).toBe(ARENA_HEIGHT / 2)
  })

  it("starts imported terrain after the 16 original terrain GIDs", () => {
    expect(ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID).toBe(17)
  })

  it("keeps representative stone platforms and bridges walkable", () => {
    const samples = [
      { label: "center", x: 1056, y: 848 },
      { label: "north-west platform", x: 460, y: 260 },
      { label: "north-east platform", x: 1568, y: 252 },
      { label: "west platform", x: 356, y: 776 },
      { label: "south-west platform", x: 380, y: 1408 },
      { label: "south platform", x: 1072, y: 1468 },
      { label: "south-east platform", x: 1632, y: 1344 },
      { label: "east platform", x: 1756, y: 944 },
      { label: "north bridge", x: 1056, y: 520 },
      { label: "south bridge", x: 1056, y: 1152 },
      { label: "west bridge", x: 660, y: 848 },
      { label: "east bridge", x: 1448, y: 848 },
    ]

    for (const sample of samples) {
      const blockingCollider = ARENA_NON_WALKABLE_COLLIDERS.find((rect) => pointInRect(sample.x, sample.y, rect))
      expect(blockingCollider, `${sample.label} point blocker`).toBeUndefined()
      expect(
        canOccupyWorldPosition(
          sample.x,
          sample.y,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          { width: ARENA_WIDTH, height: ARENA_HEIGHT },
          ARENA_WORLD_COLLIDERS,
        ),
        `${sample.label} footprint`,
      ).toBe(true)
    }
  })

  it("places lava at every outside edge and in internal gaps", () => {
    const samples = [
      { label: "north edge", x: ARENA_WIDTH / 2, y: 8 },
      { label: "south edge", x: ARENA_WIDTH / 2, y: ARENA_HEIGHT - 8 },
      { label: "west edge", x: 8, y: ARENA_HEIGHT / 2 },
      { label: "east edge", x: ARENA_WIDTH - 8, y: ARENA_HEIGHT / 2 },
      { label: "center-south internal gap", x: 950, y: 1200 },
      { label: "east internal gap", x: 1600, y: 1000 },
    ]

    for (const sample of samples) {
      expect(pointInRects(sample.x, sample.y, ARENA_LAVA_COLLIDERS), sample.label).toBe(true)
      expect(terrainStateAtPosition(sample.x, sample.y), sample.label).toBe("lava")
    }
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

  it("uses generated no-cliff lava arena spawn points", () => {
    expect(ARENA_SPAWN_POINTS).toEqual([
      { x: 1056, y: 848 },
      { x: 904, y: 824 },
      { x: 1208, y: 840 },
      { x: 1056, y: 696 },
      { x: 1056, y: 1000 },
      { x: 872, y: 728 },
      { x: 1240, y: 728 },
      { x: 872, y: 976 },
      { x: 1240, y: 976 },
      { x: 464, y: 264 },
      { x: 1568, y: 256 },
      { x: 328, y: 808 },
    ])
  })

  it("no two spawn points overlap (all distinct positions)", () => {
    const seen = new Set<string>()
    for (const sp of ARENA_SPAWN_POINTS) {
      const key = `${sp.x},${sp.y}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it("no spawn point overlaps editor-authored blocking colliders", () => {
    for (const sp of ARENA_SPAWN_POINTS) {
      expect(terrainStateAtPosition(sp.x, sp.y)).toBe("land")
      for (const rect of ARENA_WORLD_COLLIDERS) {
        expect(spawnOverlapsCollider(sp.x, sp.y, rect)).toBe(false)
      }
    }
  })
})
