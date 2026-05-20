import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  Knockback,
  PlayerTag,
  Position,
  TerrainState,
  TERRAIN_KIND,
} from "../components"
import type { SimCtx } from "../simulation"
import { knockbackSystem } from "./knockbackSystem"
import { terrainStateAtPosition } from "../../../shared/collision/terrainHazards"

describe("knockbackSystem", () => {
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
