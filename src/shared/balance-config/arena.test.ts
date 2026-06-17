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

function pointOverlapsCollider(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

function hasFootprintReachablePath(
  start: { x: number; y: number },
  target: { x: number; y: number },
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  step: number,
): boolean {
  const cols = Math.floor((bounds.maxX - bounds.minX) / step) + 1
  const rows = Math.floor((bounds.maxY - bounds.minY) / step) + 1
  const legal = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = bounds.minX + col * step
      const y = bounds.minY + row * step
      legal[row * cols + col] = canOccupyWorldPosition(
        x,
        y,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        { width: ARENA_WIDTH, height: ARENA_HEIGHT },
        ARENA_WORLD_COLLIDERS,
      )
        ? 1
        : 0
    }
  }

  const nearestLegal = (point: { x: number; y: number }) => {
    let best: { col: number; row: number; distSq: number } | null = null
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!legal[row * cols + col]) continue
        const x = bounds.minX + col * step
        const y = bounds.minY + row * step
        const distSq = (x - point.x) ** 2 + (y - point.y) ** 2
        if (!best || distSq < best.distSq) best = { col, row, distSq }
      }
    }
    return best
  }

  const first = nearestLegal(start)
  const last = nearestLegal(target)
  expect(first, "start has nearby legal footprint center").not.toBeNull()
  expect(last, "target has nearby legal footprint center").not.toBeNull()
  if (!first || !last) return false

  const seen = new Uint8Array(cols * rows)
  const queue: { col: number; row: number }[] = [first]
  seen[first.row * cols + first.col] = 1
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    if (current.col === last.col && current.row === last.row) return true
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const col = current.col + dc
      const row = current.row + dr
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue
      const index = row * cols + col
      if (seen[index] || !legal[index]) continue
      seen[index] = 1
      queue.push({ col, row })
    }
  }

  return false
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
      ARENA_PROP_COLLIDERS.length + ARENA_NON_WALKABLE_COLLIDERS.length,
    )
    for (const rect of ARENA_NON_WALKABLE_COLLIDERS) {
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.height).toBeGreaterThan(0)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(ARENA_WIDTH)
      expect(rect.y + rect.height).toBeLessThanOrEqual(ARENA_HEIGHT)
    }
  })

  it("exposes explicit native lava and cliff regions", () => {
    expect(ARENA_LAVA_COLLIDERS.length).toBeGreaterThan(0)
    expect(ARENA_CLIFF_COLLIDERS.length).toBeGreaterThan(0)
    for (const rect of [...ARENA_LAVA_COLLIDERS, ...ARENA_CLIFF_COLLIDERS]) {
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.height).toBeGreaterThan(0)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(ARENA_WIDTH)
      expect(rect.y + rect.height).toBeLessThanOrEqual(ARENA_HEIGHT)
    }
  })

  it("has native image dimensions while retaining 64px broadphase cells", () => {
    expect(TILE_SIZE_PX).toBe(64)
    expect(ARENA_WIDTH).toBe(1402)
    expect(ARENA_HEIGHT).toBe(1122)
    expect(ARENA_COLS).toBeGreaterThan(0)
    expect(ARENA_ROWS).toBeGreaterThan(0)
  })

  it("has correct center coordinates", () => {
    expect(ARENA_CENTER_X).toBe(ARENA_WIDTH / 2)
    expect(ARENA_CENTER_Y).toBe(ARENA_HEIGHT / 2)
  })

  it("starts imported terrain after the 16 original terrain GIDs", () => {
    expect(ARENA_LAYOUT_IMPORTED_TILE_FIRST_GID).toBe(17)
  })

  it("keeps the top-left platform connected through its diagonal bridge", () => {
    const samples = [
      { label: "platform", x: 164, y: 154 },
      { label: "platform seam", x: 218, y: 206 },
      { label: "bridge upper", x: 248, y: 220 },
      { label: "bridge middle", x: 320, y: 280 },
      { label: "bridge lower", x: 392, y: 350 },
      { label: "main arena join", x: 430, y: 365 },
    ]
    for (const sample of samples) {
      const blockingCollider = ARENA_NON_WALKABLE_COLLIDERS.find((rect) =>
        pointOverlapsCollider(sample.x, sample.y, rect),
      )
      expect(blockingCollider, sample.label).toBeUndefined()
    }
    expect(
      hasFootprintReachablePath(
        { x: 164, y: 154 },
        { x: 430, y: 365 },
        { minX: 40, maxX: 520, minY: 50, maxY: 430 },
        4,
      ),
    ).toBe(true)
  })

  it("keeps native jump islands, side decks, and horizontal bridges walkable", () => {
    const samples = [
      { label: "bottom-left island", x: 452, y: 990 },
      { label: "bottom-right island", x: 950, y: 990 },
      { label: "top-left tiny island", x: 393, y: 43 },
      { label: "top-right tiny island", x: 1009, y: 43 },
      { label: "left horizontal bridge", x: 103, y: 568 },
      { label: "right horizontal bridge", x: 1300, y: 568 },
      { label: "left side deck", x: 104, y: 423 },
      { label: "right side deck", x: 1298, y: 429 },
    ]

    for (const sample of samples) {
      const blockingCollider = ARENA_NON_WALKABLE_COLLIDERS.find((rect) =>
        pointOverlapsCollider(sample.x, sample.y, rect),
      )
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

  it("does not leave stale broad walkable residue around hand-guided side islands", () => {
    const samples = [
      { label: "top-left tiny island old spill", x: 465, y: 40 },
      { label: "top-right tiny island old spill", x: 937, y: 40 },
      { label: "left side deck old top crescent", x: 104, y: 340 },
      { label: "right side deck old top crescent", x: 1298, y: 340 },
      { label: "left side deck old vertical stem", x: 104, y: 510 },
      { label: "right side deck old vertical stem", x: 1298, y: 510 },
      { label: "left side deck old edge sliver", x: 10, y: 390 },
      { label: "right side deck old edge sliver", x: 1392, y: 390 },
    ]

    for (const sample of samples) {
      const blockingCollider = ARENA_NON_WALKABLE_COLLIDERS.find((rect) =>
        pointOverlapsCollider(sample.x, sample.y, rect),
      )
      expect(blockingCollider, sample.label).toBeDefined()
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
      for (const rect of ARENA_WORLD_COLLIDERS) {
        expect(spawnOverlapsCollider(sp.x, sp.y, rect)).toBe(false)
      }
    }
  })
})
