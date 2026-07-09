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
import {
  PlayerInputQueue,
  type PlayerInputQueueMap,
} from "@/server/game/playerInputQueue"
import { createGameSimulation } from "@/server/game/simulation"
import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_HEIGHT,
  ARENA_LAVA_COLLIDERS,
  ARENA_WIDTH,
  ARENA_WORLD_COLLIDERS,
} from "@/shared/balance-config/arena"
import {
  JUMP_LANDING_GRACE_PX,
  PLAYER_WORLD_COLLISION_FOOTPRINT,
} from "@/shared/balance-config/combat"
import { terrainStateAtPosition } from "@/shared/collision/terrainHazards"
import {
  canOccupyWorldPosition,
  resolveJumpLandingWithGrace,
} from "@/shared/collision/worldCollision"
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

function queue(payload: PlayerInputPayload): PlayerInputQueueMap {
  return new Map([["user1", new PlayerInputQueue([payload])]])
}

/**
 * Finds a footprint center that overlaps non-walkable terrain when grounded.
 */
function findIllegalGroundPoint(): { x: number; y: number } {
  const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
  const edgeOverlapPx = Math.min(2, JUMP_LANDING_GRACE_PX)
  const candidatesFor = (pit: { x: number; y: number; width: number; height: number }) => [
    {
      x: pit.x + pit.width + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX - edgeOverlapPx,
      y: pit.y + pit.height / 2,
      movementX: 1,
      movementY: 0,
    },
    {
      x: pit.x - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX + edgeOverlapPx,
      y: pit.y + pit.height / 2,
      movementX: -1,
      movementY: 0,
    },
    {
      x: pit.x + pit.width / 2,
      y:
        pit.y +
        pit.height +
        PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY +
        PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY -
        edgeOverlapPx,
      movementX: 0,
      movementY: 1,
    },
    {
      x: pit.x + pit.width / 2,
      y:
        pit.y -
        PLAYER_WORLD_COLLISION_FOOTPRINT.radiusY +
        PLAYER_WORLD_COLLISION_FOOTPRINT.offsetY +
        edgeOverlapPx,
      movementX: 0,
      movementY: -1,
    },
  ]

  for (const pit of ARENA_WORLD_COLLIDERS) {
    for (const candidate of candidatesFor(pit)) {
      if (terrainStateAtPosition(candidate.x, candidate.y) !== "land") continue
      if (
        canOccupyWorldPosition(
          candidate.x,
          candidate.y,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          bounds,
          ARENA_WORLD_COLLIDERS,
        )
      ) {
        continue
      }
      if (
        resolveJumpLandingWithGrace(
          candidate.x,
          candidate.y,
          PLAYER_WORLD_COLLISION_FOOTPRINT,
          bounds,
          ARENA_WORLD_COLLIDERS,
          {
            movementX: candidate.movementX,
            movementY: candidate.movementY,
            gracePx: JUMP_LANDING_GRACE_PX,
          },
        )
      ) {
        return { x: candidate.x, y: candidate.y }
      }
    }
  }
  throw new Error("expected non-walkable landing-edge sample")
}

function sampleTopLavaEdge(): {
  x: number
  jumpStartY: number
  lavaLandingY: number
  minLandingY: number
  input: Partial<PlayerInputPayload>
} {
  const topLava = ARENA_LAVA_COLLIDERS.filter((rect) => rect.y === 0).sort(
    (a, b) => b.width - a.width,
  )[0]
  if (!topLava) throw new Error("expected a native top-edge lava band")

  const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
  const lavaLandingY = topLava.y + 16
  const jumpStartY = topLava.y + 24
  const minLandingY = topLava.y + topLava.height + 16

  for (
    let x = topLava.x + PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX + 44;
    x < topLava.x + topLava.width - PLAYER_WORLD_COLLISION_FOOTPRINT.radiusX;
    x += 16
  ) {
    if (terrainStateAtPosition(x, lavaLandingY) !== "lava") continue
    if (terrainStateAtPosition(x, jumpStartY) !== "lava") continue
    if (terrainStateAtPosition(x, minLandingY) !== "land") continue
    if (
      !canOccupyWorldPosition(
        x,
        minLandingY,
        PLAYER_WORLD_COLLISION_FOOTPRINT,
        bounds,
        ARENA_WORLD_COLLIDERS,
      )
    ) {
      continue
    }
    return { x, jumpStartY, lavaLandingY, minLandingY, input: { down: true } }
  }

  throw new Error("expected a reachable native lava edge bordering land")
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
    const jump = sampleTopLavaEdge()
    const bounds = { width: ARENA_WIDTH, height: ARENA_HEIGHT }

    AbilitySlots.slot1[eid] = ABILITY_INDEX.jump
    Position.x[eid] = jump.x
    Position.y[eid] = jump.jumpStartY

    for (let tick = 0; tick < 80; tick++) {
      sim.tick(
        queue(input({ ...jump.input, abilitySlot: tick === 0 ? 1 : null, seq: tick })),
        Date.now() + tick * 16.667,
      )
      if (!hasComponent(sim.world, eid, JumpArc) && tick > 0) break
    }

    expect(Health.current[eid]).toBeGreaterThan(0)
    expect(hasComponent(sim.world, eid, JumpArc)).toBe(false)
    expect(Position.y[eid]).toBeGreaterThanOrEqual(jump.minLandingY)
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
    const lava = sampleTopLavaEdge()

    Position.x[eid] = lava.x
    Position.y[eid] = lava.jumpStartY
    TerrainState.kind[eid] = TERRAIN_KIND.lava

    for (let tick = 0; tick < 40; tick++) {
      sim.tick(queue(input({ ...lava.input, seq: tick })), Date.now() + tick * 16.667)
    }

    expect(terrainStateAtPosition(Position.x[eid], Position.y[eid])).toBe("lava")
    expect(Position.y[eid]).toBeLessThan(lava.minLandingY)
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)
  })

  it("lets a lava player escape to land with jump", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const jump = sampleTopLavaEdge()

    AbilitySlots.slot1[eid] = ABILITY_INDEX.jump
    Position.x[eid] = jump.x
    Position.y[eid] = jump.jumpStartY
    TerrainState.kind[eid] = TERRAIN_KIND.lava

    for (let tick = 0; tick < 90; tick++) {
      sim.tick(
        queue(input({ ...jump.input, abilitySlot: tick === 0 ? 1 : null, seq: tick })),
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
    const lava = sampleTopLavaEdge()

    Position.x[eid] = lava.x
    Position.y[eid] = lava.lavaLandingY
    addComponent(sim.world, eid, JumpArc)
    JumpArc.z[eid] = 1
    JumpArc.vz[eid] = -1000

    sim.tick(new Map(), Date.now())
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)

    for (let tick = 1; tick < 41; tick++) {
      sim.tick(queue(input({ ...lava.input, seq: tick })), Date.now() + tick * 16.667)
    }

    expect(terrainStateAtPosition(Position.x[eid], Position.y[eid])).toBe("lava")
    expect(Position.y[eid]).toBeLessThan(lava.minLandingY)
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)
  })

  it("keeps the native arena free of cliff landings", () => {
    const sim = createGameSimulation(Date.now())
    const eid = sim.addPlayer("user1", "Alice", "red_wizard", 0)
    const edge = sampleTopLavaEdge()

    expect(ARENA_CLIFF_COLLIDERS).toHaveLength(0)

    Position.x[eid] = edge.x
    Position.y[eid] = edge.minLandingY
    addComponent(sim.world, eid, JumpArc)
    JumpArc.z[eid] = 1
    JumpArc.vz[eid] = -1000

    sim.tick(new Map(), Date.now())

    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.land)
  })
})
