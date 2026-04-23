import { describe, it, expect } from "vitest"
import { createWorld, addEntity, addComponent } from "bitecs"

import { Position, PlayerTag } from "../components"
import { resolvePlayerAgainstPropColliders } from "./worldCollisionSystem"
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
