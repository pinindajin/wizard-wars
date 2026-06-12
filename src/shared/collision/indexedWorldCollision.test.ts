import { describe, expect, it } from "vitest"

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "@/shared/balance-config"
import { ARENA_WORLD_COLLIDERS } from "@/shared/balance-config/arena"
import {
  canOccupyWorldPosition,
  moveWithinWorld,
  resolveAgainstWorld,
  resolveJumpLandingWithGrace,
  type ArenaPropColliderRect,
} from "./worldCollision"
import { createSpatialQueryScratch, createStaticAabbIndex } from "./spatialIndex"
import type { IndexedColliderSet } from "./arenaSpatialIndexes"
import {
  canOccupyWorldPositionIndexed,
  moveWithinWorldIndexed,
  resolveAgainstWorldIndexed,
  resolveJumpLandingWithGraceIndexed,
  terrainStateAtPositionIndexed,
} from "./indexedWorldCollision"
import { terrainStateAtPosition } from "./terrainHazards"

const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

describe("indexedWorldCollision", () => {
  it("matches brute-force occupancy checks for representative points", () => {
    const points = [
      { x: 710, y: 562 },
      { x: 448, y: 430 },
      { x: 1030, y: 562 },
      { x: 64, y: 64 },
      { x: ARENA_WIDTH - 20, y: ARENA_HEIGHT - 20 },
    ]

    for (const point of points) {
      expect(
        canOccupyWorldPositionIndexed(
          point.x,
          point.y,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
        ),
      ).toBe(
        canOccupyWorldPosition(
          point.x,
          point.y,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
          ARENA_WORLD_COLLIDERS,
        ),
      )
    }
  })

  it("matches brute-force jump landing grace candidates and fallback resolution", () => {
    const footprint = { radiusX: 10, radiusY: 10, offsetY: 0 }
    const bounds = { width: 200, height: 200 }
    const colliders: ArenaPropColliderRect[] = [{ x: 50, y: 50, width: 20, height: 20 }]
    const colliderSet = createTestColliderSet(colliders)
    const cases = [
      { x: 42, y: 60, context: { movementX: -10, movementY: 0, gracePx: 2 } },
      { x: 60, y: 78, context: { movementX: 0, movementY: 10, gracePx: 2 } },
      { x: 49, y: 60, context: { movementX: 0, movementY: 0, gracePx: 10 } },
      { x: 42, y: 60, context: { movementX: 0, movementY: 0, gracePx: 0 } },
    ]

    for (const c of cases) {
      expect(
        resolveJumpLandingWithGraceIndexed(c.x, c.y, footprint, bounds, c.context, colliderSet),
      ).toEqual(resolveJumpLandingWithGrace(c.x, c.y, footprint, bounds, colliders, c.context))
    }
  })

  it("matches brute-force movement resolution", () => {
    const cases = [
      { x: 710, y: 562, stepX: 3, stepY: 0 },
      { x: 384, y: 160, stepX: -4, stepY: 0 },
      { x: 935, y: 562, stepX: 0, stepY: 3 },
      { x: 710, y: 910, stepX: 2, stepY: -2 },
    ]

    for (const c of cases) {
      expect(
        moveWithinWorldIndexed(
          c.x,
          c.y,
          c.stepX,
          c.stepY,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
        ),
      ).toEqual(
        moveWithinWorld(
          c.x,
          c.y,
          c.stepX,
          c.stepY,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
          ARENA_WORLD_COLLIDERS,
        ),
      )
    }
  })

  it("falls back to full resolution when local indexed passes cannot clear a deep overlap", () => {
    const start = { x: 1150, y: 90 }
    const indexed = resolveAgainstWorldIndexed(
      start.x,
      start.y,
      PLAYER_WORLD_COLLISION_FOOTPRINT,
      ARENA_BOUNDS,
    )

    expect(
      canOccupyWorldPosition(
        indexed.x,
        indexed.y,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        ARENA_BOUNDS,
        ARENA_WORLD_COLLIDERS,
      ),
    ).toBe(true)
    expect(indexed).toEqual(
      resolveAgainstWorld(
        start.x,
        start.y,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        ARENA_BOUNDS,
        ARENA_WORLD_COLLIDERS,
      ),
    )
  })

  it("matches brute-force jump landing checks", () => {
    const context = { movementX: 120, movementY: 0, gracePx: 6 }
    const cases = [
      { x: 710, y: 562 },
      { x: 448, y: 430 },
      { x: 1184, y: 856 },
    ]

    for (const c of cases) {
      expect(
        resolveJumpLandingWithGraceIndexed(
          c.x,
          c.y,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
          context,
        ),
      ).toEqual(
        resolveJumpLandingWithGrace(
          c.x,
          c.y,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          ARENA_BOUNDS,
          ARENA_WORLD_COLLIDERS,
          context,
        ),
      )
    }
  })

  it("matches brute-force terrain sampling and half-open point boundaries", () => {
    const points = [
      { x: 256, y: 64 },
      { x: 1110, y: 128 },
      { x: 0, y: 128 },
      { x: 710, y: 562 },
      { x: 160, y: 18 },
    ]

    for (const point of points) {
      expect(terrainStateAtPositionIndexed(point.x, point.y)).toBe(
        terrainStateAtPosition(point.x, point.y),
      )
    }
    expect(terrainStateAtPositionIndexed(160, 18)).toBe("cliff")
  })
})

function createTestColliderSet(rects: readonly ArenaPropColliderRect[]): IndexedColliderSet {
  return {
    rects,
    index: createStaticAabbIndex(rects, { cellSizePx: 64 }),
    scratch: createSpatialQueryScratch(),
  }
}
