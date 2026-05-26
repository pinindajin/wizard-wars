import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "../../../shared/balance-config"
import { ARENA_WORLD_COLLIDERS } from "../../../shared/balance-config/arena"
import {
  canOccupyWorldPosition,
  type ArenaPropColliderRect,
} from "../../../shared/collision/worldCollision"
import { terrainStateAtPosition } from "../../../shared/collision/terrainHazards"
import {
  Knockback,
  PlayerTag,
  Position,
  TerrainState,
  TERRAIN_KIND,
} from "../components"
import type { SimCtx } from "../simulation"
import { knockbackSystem } from "./knockbackSystem"

const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

function addGroundedPlayerWithKnockback(
  x: number,
  y: number,
  impulseX: number,
  impulseY: number,
  remainingPx = 80,
) {
  const world = createWorld()
  const eid = addEntity(world)
  addComponent(world, eid, PlayerTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, TerrainState)
  addComponent(world, eid, Knockback)

  Position.x[eid] = x
  Position.y[eid] = y
  TerrainState.kind[eid] = TERRAIN_KIND.land
  Knockback.impulseX[eid] = impulseX
  Knockback.impulseY[eid] = impulseY
  Knockback.remainingPx[eid] = remainingPx

  return { world, eid }
}

function canPlayerOccupy(x: number, y: number, colliders: readonly ArenaPropColliderRect[]) {
  return canOccupyWorldPosition(
    x,
    y,
    PLAYER_WORLD_COLLISION_FOOTPRINT,
    ARENA_BOUNDS,
    colliders,
  )
}

describe("knockbackSystem", () => {
  it("keeps grounded land players out of border blockers during knockback", () => {
    const topBorder = ARENA_WORLD_COLLIDERS[0]!
    const startX = topBorder.x + 342
    const startY =
      topBorder.y +
      topBorder.height +
      PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY -
      PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY +
      2
    const { world, eid } = addGroundedPlayerWithKnockback(startX, startY, 0, -1)

    expect(canPlayerOccupy(Position.x[eid], Position.y[eid], ARENA_WORLD_COLLIDERS)).toBe(
      true,
    )

    knockbackSystem({ world } as SimCtx)

    expect(Position.y[eid]).toBeGreaterThanOrEqual(
      topBorder.y +
        topBorder.height +
        PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY -
        PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY,
    )
    expect(canPlayerOccupy(Position.x[eid], Position.y[eid], ARENA_WORLD_COLLIDERS)).toBe(
      true,
    )
  })

  it("keeps grounded land players out of existing non-walkable colliders during knockback", () => {
    const blocker = ARENA_WORLD_COLLIDERS.find((rect) => {
      if (rect.x <= 0 || rect.y <= 0 || rect.width < 64 || rect.height < 64) return false
      const startX = rect.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX - 2
      const startY = rect.y + rect.height / 2 - PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY
      return canPlayerOccupy(startX, startY, ARENA_WORLD_COLLIDERS)
    })
    expect(blocker).toBeDefined()
    const rect = blocker!
    const startX = rect.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX - 2
    const startY = rect.y + rect.height / 2 - PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY
    const { world, eid } = addGroundedPlayerWithKnockback(startX, startY, 1, 0)

    knockbackSystem({ world } as SimCtx)

    expect(canPlayerOccupy(Position.x[eid], Position.y[eid], ARENA_WORLD_COLLIDERS)).toBe(
      true,
    )
    expect(Position.x[eid]).toBeLessThanOrEqual(
      rect.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX,
    )
  })

  it("keeps grounded lava players from being knocked onto land", () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    addComponent(world, eid, TerrainState)
    addComponent(world, eid, Knockback)

    Position.x[eid] = 352
    Position.y[eid] = 160
    TerrainState.kind[eid] = TERRAIN_KIND.lava
    Knockback.impulseX[eid] = 1
    Knockback.impulseY[eid] = 0
    Knockback.remainingPx[eid] = 80

    for (let tick = 0; tick < 8; tick++) {
      knockbackSystem({ world } as SimCtx)
    }

    expect(terrainStateAtPosition(Position.x[eid], Position.y[eid])).toBe("lava")
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)
  })
})
