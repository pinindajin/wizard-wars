import { addComponent, addEntity, createWorld, hasComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  PlayerTag,
  Position,
  Radius,
  TerrainState,
  TERRAIN_KIND,
  NeedsWorldCollisionResolution,
} from "../components"
import type { SimCtx } from "../simulation"
import { playerCollisionSystem } from "./playerCollisionSystem"
import { ARENA_HEIGHT, ARENA_LAVA_COLLIDERS, ARENA_WIDTH, PLAYER_RADIUS_PX } from "../../../shared/balance-config"
import { terrainStateAtPosition } from "../../../shared/collision/terrainHazards"

function sampleVerticalLavaToLandEdge(): {
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
          terrainStateAtPosition(x, y + 7) === "land"
        ) {
          return { x, pusherY: y - 18, lavaY: y, blockedY: y + 7 }
        }
      }
    }
  }
  throw new Error("Expected native lava with land below it")
}

describe("playerCollisionSystem", () => {
  it("marks both displaced players for world collision repair", () => {
    const world = createWorld()
    const a = addTestPlayer(world, ARENA_WIDTH / 2, ARENA_HEIGHT / 2)
    const b = addTestPlayer(world, ARENA_WIDTH / 2 + PLAYER_RADIUS_PX, ARENA_HEIGHT / 2)

    playerCollisionSystem({ world } as SimCtx)

    expect(hasComponent(world, a, NeedsWorldCollisionResolution)).toBe(true)
    expect(hasComponent(world, b, NeedsWorldCollisionResolution)).toBe(true)
  })

  it("does not mark separated players dirty", () => {
    const world = createWorld()
    const a = addTestPlayer(world, ARENA_WIDTH / 2, ARENA_HEIGHT / 2)
    const b = addTestPlayer(world, ARENA_WIDTH / 2 + PLAYER_RADIUS_PX * 4, ARENA_HEIGHT / 2)

    playerCollisionSystem({ world } as SimCtx)

    expect(hasComponent(world, a, NeedsWorldCollisionResolution)).toBe(false)
    expect(hasComponent(world, b, NeedsWorldCollisionResolution)).toBe(false)
  })

  it("keeps grounded lava players from being shoved out of lava", () => {
    const world = createWorld()
    const pusher = addEntity(world)
    const lavaPlayer = addEntity(world)
    const edge = sampleVerticalLavaToLandEdge()

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
    expect(terrainStateAtPosition(Position.x[lavaPlayer], edge.blockedY)).toBe("land")

    playerCollisionSystem({ world } as SimCtx)

    expect(Position.y[lavaPlayer]).toBe(edge.lavaY)
    expect(terrainStateAtPosition(Position.x[lavaPlayer], Position.y[lavaPlayer])).toBe("lava")
    expect(TerrainState.kind[lavaPlayer]).toBe(TERRAIN_KIND.lava)
  })
})

function addTestPlayer(
  world: ReturnType<typeof createWorld>,
  x: number,
  y: number,
): number {
  const eid = addEntity(world)
  addComponent(world, eid, PlayerTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, Radius)
  addComponent(world, eid, TerrainState)
  Radius.r[eid] = PLAYER_RADIUS_PX
  Position.x[eid] = x
  Position.y[eid] = y
  TerrainState.kind[eid] = TERRAIN_KIND.land
  return eid
}
