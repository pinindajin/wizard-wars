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
import { ARENA_HEIGHT, ARENA_LAVA_COLLIDERS, ARENA_WIDTH, PLAYER_RADIUS_PX } from "../../../shared/balance-config"
import { terrainStateAtPosition } from "../../../shared/collision/terrainHazards"

function sampleVerticalLavaToCliffEdge(): {
  readonly x: number
  readonly pusherY: number
  readonly lavaY: number
  readonly blockedY: number
} {
  for (const rect of [...ARENA_LAVA_COLLIDERS].sort((a, b) => a.y - b.y || a.x - b.x)) {
    for (let x = rect.x + 1; x < rect.x + rect.width - 1; x++) {
      if (x < 30 || x >= ARENA_WIDTH - 30) continue
      for (let y = rect.y + rect.height - 1; y >= rect.y; y--) {
        if (y < 25 || y >= ARENA_HEIGHT - 8) continue
        if (
          terrainStateAtPosition(x, y) === "lava" &&
          terrainStateAtPosition(x, y - 18) === "lava" &&
          terrainStateAtPosition(x, y + 7) === "cliff"
        ) {
          return { x, pusherY: y - 18, lavaY: y, blockedY: y + 7 }
        }
      }
    }
  }
  throw new Error("Expected native lava with a cliff below it")
}

describe("playerCollisionSystem", () => {
  it("keeps grounded lava players from being shoved off lava", () => {
    const world = createWorld()
    const pusher = addEntity(world)
    const lavaPlayer = addEntity(world)
    const edge = sampleVerticalLavaToCliffEdge()

    for (const eid of [pusher, lavaPlayer]) {
      addComponent(world, eid, PlayerTag)
      addComponent(world, eid, Position)
      addComponent(world, eid, Radius)
      addComponent(world, eid, TerrainState)
      Radius.r[eid] = PLAYER_RADIUS_PX
    }

    Position.x[pusher] = edge.x
    Position.y[pusher] = edge.pusherY
    TerrainState.kind[pusher] = TERRAIN_KIND.lava

    Position.x[lavaPlayer] = edge.x
    Position.y[lavaPlayer] = edge.lavaY
    TerrainState.kind[lavaPlayer] = TERRAIN_KIND.lava

    expect(terrainStateAtPosition(Position.x[lavaPlayer], Position.y[lavaPlayer])).toBe("lava")
    expect(terrainStateAtPosition(Position.x[lavaPlayer], edge.blockedY)).toBe("cliff")

    playerCollisionSystem({ world } as SimCtx)

    expect(Position.y[lavaPlayer]).toBe(edge.lavaY)
    expect(terrainStateAtPosition(Position.x[lavaPlayer], Position.y[lavaPlayer])).toBe("lava")
    expect(TerrainState.kind[lavaPlayer]).toBe(TERRAIN_KIND.lava)
  })
})
