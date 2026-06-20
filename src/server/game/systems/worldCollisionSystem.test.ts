import { describe, it, expect, vi } from "vitest"
import { createWorld, addEntity, addComponent, hasComponent } from "bitecs"

import { Position, PlayerTag, TerrainState, NeedsWorldCollisionResolution } from "../components"
import {
  resolveDirtyPlayerWorldCollision,
  resolvePlayerAgainstPropColliders,
  worldCollisionSystem,
} from "./worldCollisionSystem"
import type { SimCtx } from "../simulation"
import { ARENA_WORLD_COLLIDERS } from "../../../shared/balance-config/arena"
describe("resolvePlayerAgainstPropColliders", () => {
  it("pushes a circular player out of an overlapping rectangle", () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    // Overlap the top edge of a 40×40 box (center must not lie strictly inside the rect
    // or circleRectMTV yields a degenerate zero push).
    Position.x[eid] = 125
    Position.y[eid] = 95

    const colliders = [{ x: 100, y: 100, width: 40, height: 40 }] as const
    resolvePlayerAgainstPropColliders(eid, colliders)

    const moved =
      Math.abs(Position.x[eid] - 125) > 0.5 || Math.abs(Position.y[eid] - 95) > 0.5
    expect(moved).toBe(true)
  })
})

describe("worldCollisionSystem dirty collision repair", () => {
  it("skips untagged players entirely", () => {
    const world = createWorld()
    const illegal = sampleIllegalWorldPosition()
    const tagged = addPlayer(world, illegal.x, illegal.y, true)
    const untagged = addPlayer(world, illegal.x, illegal.y, false)

    worldCollisionSystem({ world } as SimCtx)

    expect(Position.x[tagged] !== illegal.x || Position.y[tagged] !== illegal.y).toBe(true)
    expect(hasComponent(world, tagged, NeedsWorldCollisionResolution)).toBe(false)
    expect(Position.x[untagged]).toBe(illegal.x)
    expect(Position.y[untagged]).toBe(illegal.y)
  })

  it("clears the dirty tag without resolving when the current position is already legal", () => {
    const world = createWorld()
    const eid = addPlayer(world, 500, 500, true)
    const canOccupy = vi.fn(() => true)
    const resolve = vi.fn(() => ({ x: 1, y: 1 }))

    resolveDirtyPlayerWorldCollision(world, eid, { canOccupy, resolve })

    expect(Position.x[eid]).toBe(500)
    expect(Position.y[eid]).toBe(500)
    expect(resolve).not.toHaveBeenCalled()
    expect(hasComponent(world, eid, NeedsWorldCollisionResolution)).toBe(false)
  })

  it("falls back to land collision when terrain state is out of range", () => {
    const world = createWorld()
    const eid = addPlayer(world, 500, 500, true)
    TerrainState.kind[eid] = 99
    const canOccupy = vi.fn(() => true)

    resolveDirtyPlayerWorldCollision(world, eid, {
      canOccupy,
      resolve: vi.fn(() => ({ x: 1, y: 1 })),
    })

    expect(canOccupy).toHaveBeenCalled()
    expect(hasComponent(world, eid, NeedsWorldCollisionResolution)).toBe(false)
  })

  it("resolves illegal dirty players and clears the dirty tag", () => {
    const world = createWorld()
    const eid = addPlayer(world, 500, 500, true)

    resolveDirtyPlayerWorldCollision(world, eid, {
      canOccupy: vi.fn(() => false),
      resolve: vi.fn(() => ({ x: 520, y: 530 })),
    })

    expect(Position.x[eid]).toBe(520)
    expect(Position.y[eid]).toBe(530)
    expect(hasComponent(world, eid, NeedsWorldCollisionResolution)).toBe(false)
  })
})

function addPlayer(
  world: ReturnType<typeof createWorld>,
  x: number,
  y: number,
  dirty: boolean,
): number {
  const eid = addEntity(world)
  addComponent(world, eid, PlayerTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, TerrainState)
  if (dirty) addComponent(world, eid, NeedsWorldCollisionResolution)
  Position.x[eid] = x
  Position.y[eid] = y
  return eid
}

function sampleIllegalWorldPosition(): { readonly x: number; readonly y: number } {
  const rect = ARENA_WORLD_COLLIDERS.find((item) => item.width >= 40 && item.height >= 40)
  if (!rect) throw new Error("Expected a world collider large enough for collision repair")
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}
