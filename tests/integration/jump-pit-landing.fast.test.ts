import { addComponent, hasComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  ABILITY_INDEX,
  AbilitySlots,
  Health,
  JumpArc,
  Position,
  TerrainState,
  TERRAIN_KIND,
} from "@/server/game/components"
import { computePlayerAnimState } from "@/server/game/playerAnimState"
import { computePlayerMoveState } from "@/server/game/playerMoveState"
import { createGameSimulation } from "@/server/game/simulation"
import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_HEIGHT,
  ARENA_LAVA_COLLIDERS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import { PLAYER_WORLD_COLLISION_FOOTPRINT } from "@/shared/balance-config/combat"
import { terrainStateAtPosition } from "@/shared/collision/terrainHazards"
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
  for (const pit of ARENA_WORLD_COLLIDERS) {
    for (let ix = 0.25; ix <= 0.75; ix += 0.05) {
      for (let iy = 0.25; iy <= 0.75; iy += 0.05) {
        const x = pit.x + pit.width * ix
        const y = pit.y + pit.height * iy
        if (terrainStateAtPosition(x, y) !== "land") continue
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

function sampleNativeLavaEdgeJump(): { startX: number; y: number; minLandingX: number } {
  const sample = { startX: 581, y: 129, minLandingX: 606 }
  if (terrainStateAtPosition(sample.startX, sample.y) !== "lava") {
    throw new Error("expected native lava-edge jump start to be lava")
  }
  if (terrainStateAtPosition(sample.minLandingX + 1, sample.y) !== "land") {
    throw new Error("expected native lava-edge jump landing threshold to be land")
  }
  return sample
}

function sampleWideLavaRect(): { x: number; y: number; width: number; height: number } {
  const lava = ARENA_LAVA_COLLIDERS.find((rect) =>
    rect.x > 24 &&
    rect.y > 0 &&
    rect.width >= 250 &&
    rect.height >= 100 &&
    terrainStateAtPosition(rect.x + rect.width / 2, rect.y + rect.height / 2) === "lava",
  )
  if (!lava) throw new Error("expected a wide native lava area")
  return lava
}

function sampleCliffOnlyRect(): { x: number; y: number; width: number; height: number } {
  const cliff = ARENA_CLIFF_COLLIDERS.find((rect) =>
    terrainStateAtPosition(rect.x + rect.width / 2, rect.y + rect.height / 2) === "cliff",
  )
  if (!cliff) throw new Error("expected a native cliff area outside lava")
  return cliff
}

describe("jump pit landing (integration)", () => {
  it("resolves a jump landing out of a land-state prop blocker", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const { x, y } = findIllegalGroundPoint()

    Position.x[eid] = x
    Position.y[eid] = y
    const start = { x, y }
    addComponent(sim.world, eid, JumpArc)
    JumpArc.z[eid] = 120
    JumpArc.vz[eid] = -8000

    sim.tick(new Map(), Date.now())

    expect(Health.current[eid]).toBeGreaterThan(0)
    expect(
      canOccupyWorldPosition(
        Position.x[eid],
        Position.y[eid],
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        { width: ARENA_WIDTH, height: ARENA_HEIGHT },
        ARENA_WORLD_COLLIDERS,
      ),
    ).toBe(true)
    expect(Position.x[eid] !== start.x || Position.y[eid] !== start.y).toBe(true)
  })

  it("clears a native lava edge at base movement speed", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const jump = sampleNativeLavaEdgeJump()
    const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

    AbilitySlots.slot1[eid] = ABILITY_INDEX.jump
    Position.x[eid] = jump.startX
    Position.y[eid] = jump.y

    for (let tick = 0; tick < 80; tick++) {
      sim.tick(
        queue(input({ right: true, abilitySlot: tick === 0 ? 1 : null, seq: tick })),
        Date.now() + tick * 16.667,
      )
      if (!hasComponent(sim.world, eid, JumpArc) && tick > 0) break
    }

    expect(Health.current[eid]).toBeGreaterThan(0)
    expect(hasComponent(sim.world, eid, JumpArc)).toBe(false)
    expect(Position.x[eid]).toBeGreaterThanOrEqual(jump.minLandingX)
    expect(terrainStateAtPosition(Position.x[eid], Position.y[eid])).toBe("land")
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

  it("blocks grounded lava players from walking onto land", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const lava = sampleWideLavaRect()

    Position.x[eid] = lava.x + lava.width / 2
    Position.y[eid] = lava.y + lava.height / 2
    TerrainState.kind[eid] = TERRAIN_KIND.lava

    for (let tick = 0; tick < 40; tick++) {
      sim.tick(queue(input({ right: true, seq: tick })), Date.now() + tick * 16.667)
    }

    expect(terrainStateAtPosition(Position.x[eid], Position.y[eid])).toBe("lava")
    expect(Position.x[eid]).toBeLessThan(lava.x + lava.width)
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)
  })

  it("lets a lava player escape to land with jump", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const jump = sampleNativeLavaEdgeJump()

    AbilitySlots.slot1[eid] = ABILITY_INDEX.jump
    Position.x[eid] = jump.startX
    Position.y[eid] = jump.y
    TerrainState.kind[eid] = TERRAIN_KIND.lava

    for (let tick = 0; tick < 90; tick++) {
      sim.tick(
        queue(input({ right: true, abilitySlot: tick === 0 ? 1 : null, seq: tick })),
        Date.now() + tick * 16.667,
      )
      if (!hasComponent(sim.world, eid, JumpArc) && tick > 2) break
    }

    expect(hasComponent(sim.world, eid, JumpArc)).toBe(false)
    expect(terrainStateAtPosition(Position.x[eid], Position.y[eid])).toBe("land")
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.land)
  })

  it("keeps a jump landing in lava from walking out afterward", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const lava = sampleWideLavaRect()

    Position.x[eid] = lava.x + lava.width / 2
    Position.y[eid] = lava.y + lava.height / 2
    addComponent(sim.world, eid, JumpArc)
    JumpArc.z[eid] = 1
    JumpArc.vz[eid] = -1000

    sim.tick(new Map(), Date.now())
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)

    for (let tick = 1; tick < 41; tick++) {
      sim.tick(queue(input({ right: true, seq: tick })), Date.now() + tick * 16.667)
    }

    expect(terrainStateAtPosition(Position.x[eid], Position.y[eid])).toBe("lava")
    expect(Position.x[eid]).toBeLessThan(lava.x + lava.width)
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)
  })

  it("turns a cliff landing into rooted stumble slide", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const cliff = sampleCliffOnlyRect()

    Position.x[eid] = cliff.x + cliff.width / 2
    Position.y[eid] = cliff.y + cliff.height / 2
    const startX = Position.x[eid]
    addComponent(sim.world, eid, JumpArc)
    JumpArc.z[eid] = 1
    JumpArc.vz[eid] = -1000

    sim.tick(new Map(), Date.now())

    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.cliff)
    expect(computePlayerAnimState(sim.world, eid)).toBe("stumble")
    expect(computePlayerMoveState(sim.world, eid)).toBe("rooted")
    expect(Math.abs(Position.x[eid] - startX)).toBeGreaterThan(0)
  })
})
