import { addComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import { Health, JumpArc, Position } from "@/server/game/components"
import { createGameSimulation } from "@/server/game/simulation"
import {
  ARENA_HEIGHT,
  ARENA_NON_WALKABLE_COLLIDERS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import { PLAYER_WORLD_COLLISION_FOOTPRINT } from "@/shared/balance-config/combat"
import { canOccupyWorldPosition } from "@/shared/collision/worldCollision"

/**
 * Finds a footprint center that overlaps non-walkable terrain when grounded.
 */
function findIllegalGroundPoint(): { x: number; y: number } {
  const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
  for (const pit of ARENA_NON_WALKABLE_COLLIDERS) {
    for (let ix = 0.25; ix <= 0.75; ix += 0.05) {
      for (let iy = 0.25; iy <= 0.75; iy += 0.05) {
        const x = pit.x + pit.width * ix
        const y = pit.y + pit.height * iy
        if (
          !canOccupyWorldPosition(
            x,
            y,
            PLAYER_WORLD_COLLISION_FOOTPRINT,
            bounds,
            ARENA_WORLD_COLLIDERS,
          )
        ) {
          return { x, y }
        }
      }
    }
  }
  throw new Error("expected non-walkable interior sample")
}

describe("jump pit landing (integration)", () => {
  it("applies lethal damage when landing footprint is inside non-walkable", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const { x, y } = findIllegalGroundPoint()

    Position.x[eid] = x
    Position.y[eid] = y
    addComponent(sim.world, eid, JumpArc)
    JumpArc.z[eid] = 120
    JumpArc.vz[eid] = -8000
    JumpArc.liftEndsAtTick[eid] = 0

    sim.tick(new Map(), Date.now())

    expect(Health.current[eid]).toBe(0)
  })
})
