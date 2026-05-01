import { addComponent, hasComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import { ABILITY_INDEX, AbilitySlots, Health, JumpArc, Position } from "@/server/game/components"
import { createGameSimulation } from "@/server/game/simulation"
import {
  ARENA_HEIGHT,
  ARENA_NON_WALKABLE_COLLIDERS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import { PLAYER_WORLD_COLLISION_FOOTPRINT } from "@/shared/balance-config/combat"
import { canOccupyWorldPosition } from "@/shared/collision/worldCollision"
import type { PlayerInputPayload } from "@/shared/types"

function input(overrides: Partial<PlayerInputPayload> = {}): PlayerInputPayload {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    abilitySlot: null,
    abilityTargetX: 0,
    abilityTargetY: 0,
    weaponPrimary: false,
    weaponSecondary: false,
    weaponTargetX: 0,
    weaponTargetY: 0,
    useQuickItemSlot: null,
    seq: 1,
    clientSendTimeMs: Date.now(),
    ...overrides,
  }
}

function queue(payload: PlayerInputPayload): Map<string, PlayerInputPayload[]> {
  return new Map([["user1", [payload]]])
}

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

function findOneTileHorizontalGap(): { x: number; y: number; width: number; height: number } {
  const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

  for (const pit of ARENA_NON_WALKABLE_COLLIDERS) {
    if (pit.width !== 64) continue

    const y = pit.y + pit.height / 2
    const leftX = pit.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX
    const rightX = pit.x + pit.width + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX
    const leftLegal = canOccupyWorldPosition(
      leftX,
      y,
      PLAYER_WORLD_COLLISION_FOOTPRINT,
      bounds,
      ARENA_WORLD_COLLIDERS,
    )
    const rightLegal = canOccupyWorldPosition(
      rightX,
      y,
      PLAYER_WORLD_COLLISION_FOOTPRINT,
      bounds,
      ARENA_WORLD_COLLIDERS,
    )
    if (leftLegal && rightLegal) return pit
  }

  throw new Error("expected a one-tile horizontal lava gap with legal dirt on both sides")
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

    sim.tick(new Map(), Date.now())

    expect(Health.current[eid]).toBe(0)
  })

  it("clears a one-tile horizontal lava gap at base movement speed", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const pit = findOneTileHorizontalGap()
    const y = pit.y + pit.height / 2
    const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

    AbilitySlots.slot1[eid] = ABILITY_INDEX.jump
    Position.x[eid] = pit.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX
    Position.y[eid] = y

    for (let tick = 0; tick < 80; tick++) {
      sim.tick(
        queue(input({ right: true, abilitySlot: tick === 0 ? 1 : null, seq: tick })),
        Date.now() + tick * 16.667,
      )
      if (!hasComponent(sim.world, eid, JumpArc) && tick > 0) break
    }

    expect(Health.current[eid]).toBeGreaterThan(0)
    expect(hasComponent(sim.world, eid, JumpArc)).toBe(false)
    expect(Position.x[eid]).toBeGreaterThanOrEqual(
      pit.x + pit.width + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX,
    )
    expect(
      canOccupyWorldPosition(
        Position.x[eid],
        Position.y[eid],
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        bounds,
        ARENA_WORLD_COLLIDERS,
      ),
    ).toBe(true)
  })
})
