import { addComponent, addEntity, createWorld, hasComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_LAVA_COLLIDERS,
  LAVA_DAMAGE_PER_SECOND,
  TICK_RATE_HZ,
} from "../../../shared/balance-config"
import { createCommandBuffer } from "../commandBuffer"
import {
  Facing,
  Health,
  JumpArc,
  MoveFacing,
  PlayerTag,
  Position,
  Radius,
  TerrainState,
  Velocity,
  TERRAIN_KIND,
} from "../components"
import type { SimCtx } from "../simulation"
import { jumpPhysicsSystem } from "./jumpPhysicsSystem"
import { terrainHazardSystem } from "./terrainHazardSystem"

function emptyCtx(overrides: Partial<SimCtx> = {}): SimCtx {
  return {
    world: createWorld(),
    currentTick: 0,
    serverTimeMs: Date.now(),
    playerEntityMap: new Map(),
    entityPlayerMap: new Map(),
    playerUsernameMap: new Map(),
    entityUsernameMap: new Map(),
    playerHeroIdMap: new Map(),
    fireballOwnerMap: new Map(),
    fireballCreatedAtTickMap: new Map(),
    inputMap: new Map(),
    lastProcessedInputSeqByPlayer: new Map(),
    commandBuffer: createCommandBuffer(),
    matchStartedAtMs: Date.now(),
    damageRequests: [],
    deathEvents: [],
    pendingLightningBolts: [],
    playerDeaths: [],
    playerRespawns: [],
    fireballLaunches: [],
    fireballImpacts: [],
    fireballRemovedIds: [],
    lightningBolts: [],
    primaryMeleeAttacks: [],
    combatTelegraphStarts: [],
    combatTelegraphEnds: [],
    damageFloats: [],
    goldUpdates: [],
    abilitySfxEvents: [],
    matchEnded: null,
    hostEndSignal: false,
    prevPlayerStates: new Map(),
    prevFireballStates: new Map(),
    killStats: new Map(),
    activeMeleeAttacks: new Map(),
    activeCombatTelegraphs: new Map(),
    playerDeltas: [],
    fireballDeltas: [],
    ...overrides,
  }
}

function addPlayerAt(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const eid = addEntity(world)
  for (const component of [
    PlayerTag,
    Position,
    Velocity,
    Facing,
    MoveFacing,
    Radius,
    Health,
    TerrainState,
  ]) {
    addComponent(world, eid, component)
  }
  Position.x[eid] = x
  Position.y[eid] = y
  Health.current[eid] = 100
  Health.max[eid] = 100
  return eid
}

describe("terrain hazards", () => {
  it("turns a lava landing into lava terrain state without lethal pit damage", () => {
    const lava = ARENA_LAVA_COLLIDERS[0]!
    const world = createWorld()
    const eid = addPlayerAt(world, lava.x + lava.width / 2, lava.y + lava.height / 2)
    addComponent(world, eid, JumpArc)
    JumpArc.z[eid] = 1
    JumpArc.vz[eid] = -1000

    const ctx = emptyCtx({ world })
    jumpPhysicsSystem(ctx)

    expect(hasComponent(world, eid, JumpArc)).toBe(false)
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)
    expect(ctx.damageRequests).toHaveLength(0)
  })

  it("applies configured lava damage over one second", () => {
    const lava = ARENA_LAVA_COLLIDERS[0]!
    const world = createWorld()
    addPlayerAt(world, lava.x + lava.width / 2, lava.y + lava.height / 2)
    const ctx = emptyCtx({ world })

    for (let i = 0; i < TICK_RATE_HZ; i++) terrainHazardSystem(ctx)

    const total = ctx.damageRequests.reduce((sum, req) => sum + req.damage, 0)
    expect(total).toBe(LAVA_DAMAGE_PER_SECOND)
    expect(ctx.damageRequests.every((req) => req.killerAbilityId === "lava")).toBe(true)
  })

  it("slides cliff players toward lava without damage", () => {
    const cliff = ARENA_CLIFF_COLLIDERS[0]!
    const world = createWorld()
    const eid = addPlayerAt(world, cliff.x + cliff.width / 2, cliff.y + cliff.height / 2)
    TerrainState.kind[eid] = TERRAIN_KIND.cliff
    const x0 = Position.x[eid]
    const y0 = Position.y[eid]

    const ctx = emptyCtx({ world })
    terrainHazardSystem(ctx)

    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.cliff)
    expect(Math.hypot(Position.x[eid] - x0, Position.y[eid] - y0)).toBeGreaterThan(0)
    expect(ctx.damageRequests).toHaveLength(0)
  })
})
