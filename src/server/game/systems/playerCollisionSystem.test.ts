import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  PlayerTag,
  Position,
  Radius,
  TerrainState,
  TERRAIN_KIND,
} from "../components"
import type { SimCtx } from "../simulation"
import { playerCollisionSystem } from "./playerCollisionSystem"
import { PLAYER_RADIUS_PX } from "../../../shared/balance-config"
import { terrainStateAtPosition } from "../../../shared/collision/terrainHazards"

describe("playerCollisionSystem", () => {
  it("keeps grounded lava players from being shoved onto land", () => {
    const world = createWorld()
    const pusher = addEntity(world)
    const lavaPlayer = addEntity(world)

    for (const eid of [pusher, lavaPlayer]) {
      addComponent(world, eid, PlayerTag)
      addComponent(world, eid, Position)
      addComponent(world, eid, Radius)
      addComponent(world, eid, TerrainState)
      Radius.r[eid] = PLAYER_RADIUS_PX
    }

    Position.x[pusher] = 586
    Position.y[pusher] = 160
    TerrainState.kind[pusher] = TERRAIN_KIND.lava

    Position.x[lavaPlayer] = 604
    Position.y[lavaPlayer] = 160
    TerrainState.kind[lavaPlayer] = TERRAIN_KIND.lava

    expect(terrainStateAtPosition(Position.x[lavaPlayer], Position.y[lavaPlayer])).toBe("lava")
    expect(terrainStateAtPosition(615, Position.y[lavaPlayer])).toBe("land")

    playerCollisionSystem({ world } as SimCtx)

    expect(Position.x[lavaPlayer]).toBe(604)
    expect(terrainStateAtPosition(Position.x[lavaPlayer], Position.y[lavaPlayer])).toBe("lava")
    expect(TerrainState.kind[lavaPlayer]).toBe(TERRAIN_KIND.lava)
  })
})
