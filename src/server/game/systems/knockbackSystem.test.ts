import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "../../../shared/balance-config"
import {
  ARENA_LAVA_COLLIDERS,
  ARENA_NON_WALKABLE_COLLIDERS,
  ARENA_WORLD_COLLIDERS,
} from "../../../shared/balance-config/arena"
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
import { terrainHazardSystem } from "./terrainHazardSystem"

const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
const REPRESENTATIVE_BLOCKER_MIN_AREA_PX = 1_000
const UPPER_LEFT_LAVA_POINT = { x: 264, y: 108 } as const

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

function sampleUpperKnockbackCase(): {
  readonly blocker: ArenaPropColliderRect
  readonly startX: number
  readonly startY: number
} {
  const blocker = ARENA_WORLD_COLLIDERS
    .filter((rect) =>
      rect.y < 420 &&
      rect.width * rect.height >= REPRESENTATIVE_BLOCKER_MIN_AREA_PX &&
      canPlayerOccupy(
        rect.x + rect.width / 2,
        rect.y + rect.height + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY -
          PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY + 3,
        ARENA_WORLD_COLLIDERS,
      ),
    )
    .sort((a, b) => b.width * b.height - a.width * a.height)[0]
  if (!blocker) throw new Error("Expected representative native upper blocker")
  return {
    blocker,
    startX: blocker.x + blocker.width / 2,
    startY:
      blocker.y + blocker.height + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY -
      PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY + 3,
  }
}

function sampleLavaRect(): ArenaPropColliderRect {
  const lava = ARENA_LAVA_COLLIDERS.find((rect) =>
    rect.x <= UPPER_LEFT_LAVA_POINT.x &&
    rect.x + rect.width >= UPPER_LEFT_LAVA_POINT.x &&
    rect.y <= UPPER_LEFT_LAVA_POINT.y &&
    rect.y + rect.height >= UPPER_LEFT_LAVA_POINT.y,
  )
  if (!lava) throw new Error("Expected native lava at the upper-left platform edge")
  return lava
}

describe("knockbackSystem", () => {
  it("keeps grounded land players out of upper blockers during knockback", () => {
    const { blocker, startX, startY } = sampleUpperKnockbackCase()
    const { world, eid } = addGroundedPlayerWithKnockback(startX, startY, 0, -1)

    expect(canPlayerOccupy(Position.x[eid], Position.y[eid], ARENA_WORLD_COLLIDERS)).toBe(
      true,
    )

    knockbackSystem({ world } as SimCtx)

    expect(Position.y[eid]).toBeGreaterThanOrEqual(
      blocker.y +
        blocker.height +
        PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY -
        PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY,
    )
    expect(canPlayerOccupy(Position.x[eid], Position.y[eid], ARENA_WORLD_COLLIDERS)).toBe(
      true,
    )
  })

  it("lets grounded land players be knocked into lava", () => {
    const lava = ARENA_NON_WALKABLE_COLLIDERS.find((rect) => {
      if (rect.x <= 0 || rect.y <= 0 || rect.width < 8 || rect.height < 8) return false
      const startX = rect.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX - 2
      const startY = rect.y + rect.height / 2 - PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY
      return (
        terrainStateAtPosition(startX, startY) === "land" &&
        canPlayerOccupy(startX, startY, ARENA_WORLD_COLLIDERS)
      )
    })
    expect(lava).toBeDefined()
    const rect = lava!
    const startX = rect.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX - 2
    const startY = rect.y + rect.height / 2 - PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY
    const { world, eid } = addGroundedPlayerWithKnockback(startX, startY, 1, 0)

    for (let tick = 0; tick < 8; tick++) {
      knockbackSystem({ world } as SimCtx)
      if (terrainStateAtPosition(Position.x[eid], Position.y[eid]) === "lava") break
    }

    expect(canPlayerOccupy(Position.x[eid], Position.y[eid], ARENA_WORLD_COLLIDERS)).toBe(
      true,
    )
    expect(terrainStateAtPosition(Position.x[eid], Position.y[eid])).toBe("lava")

    const ctx = { world, damageRequests: [] } as unknown as SimCtx
    terrainHazardSystem(ctx)
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)
  })

  it("keeps grounded lava players from being knocked off lava", () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    addComponent(world, eid, TerrainState)
    addComponent(world, eid, Knockback)

    sampleLavaRect()
    Position.x[eid] = UPPER_LEFT_LAVA_POINT.x
    Position.y[eid] = UPPER_LEFT_LAVA_POINT.y
    TerrainState.kind[eid] = TERRAIN_KIND.lava
    Knockback.impulseX[eid] = 0
    Knockback.impulseY[eid] = 1
    Knockback.remainingPx[eid] = 80

    for (let tick = 0; tick < 8; tick++) {
      knockbackSystem({ world } as SimCtx)
    }

    expect(terrainStateAtPosition(Position.x[eid], Position.y[eid])).toBe("lava")
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)
  })
})
