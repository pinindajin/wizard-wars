import { addComponent, addEntity, createWorld, hasComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  ARENA_CLIFF_COLLIDERS,
  ARENA_LAVA_COLLIDERS,
  ARENA_SPAWN_POINTS,
  LAVA_DAMAGE_PER_SECOND,
  TICK_RATE_HZ,
} from "../../../shared/balance-config"
import { createCommandBuffer } from "../commandBuffer"
import {
  Facing,
  Health,
  JumpArc,
  MoveFacing,
  NeedsWorldCollisionResolution,
  PlayerTag,
  Position,
  Radius,
  TerrainState,
  Velocity,
  TERRAIN_KIND,
} from "../components"
import { computePlayerAnimState } from "../playerAnimState"
import { computePlayerMoveState } from "../playerMoveState"
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
    homingOrbOwnerMap: new Map(),
    homingOrbTargetPlayerMap: new Map(),
    homingOrbCastTargetPlayerMap: new Map(),
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
    homingOrbLaunches: [],
    homingOrbImpacts: [],
    homingOrbRemovedIds: [],
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
    prevHomingOrbStates: new Map(),
    killStats: new Map(),
    activeMeleeAttacks: new Map(),
    activeCombatTelegraphs: new Map(),
    invulnerableExpiresAtTickByEntity: new Map(),
    playerDeltas: [],
    fireballDeltas: [],
    homingOrbDeltas: [],
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

  it("marks successful land landings for world collision repair", () => {
    const spawn = ARENA_SPAWN_POINTS[0]!
    const world = createWorld()
    const eid = addPlayerAt(world, spawn.x, spawn.y)
    addComponent(world, eid, JumpArc)
    JumpArc.z[eid] = 1
    JumpArc.vz[eid] = -1000

    jumpPhysicsSystem(emptyCtx({ world }))

    expect(hasComponent(world, eid, JumpArc)).toBe(false)
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.land)
    expect(hasComponent(world, eid, NeedsWorldCollisionResolution)).toBe(true)
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

  it("continues processing players after earlier land and lava players", () => {
    const lava = ARENA_LAVA_COLLIDERS[1]!
    const world = createWorld()
    const landSpawn = ARENA_SPAWN_POINTS[0]!
    const landPlayer = addPlayerAt(world, landSpawn.x, landSpawn.y)
    const lavaPlayer = addPlayerAt(world, lava.x + lava.width / 2, lava.y + lava.height / 2)
    const laterLavaPlayer = addPlayerAt(world, lava.x + lava.width / 2, lava.y + lava.height / 2)
    const ctx = emptyCtx({ world })

    terrainHazardSystem(ctx)

    expect(TerrainState.kind[landPlayer]).toBe(TERRAIN_KIND.land)
    expect(TerrainState.kind[lavaPlayer]).toBe(TERRAIN_KIND.lava)
    expect(TerrainState.kind[laterLavaPlayer]).toBe(TERRAIN_KIND.lava)
  })

  it("clears stale cliff state on land in arenas without native cliff terrain", () => {
    const spawn = ARENA_SPAWN_POINTS[0]!
    const world = createWorld()
    const eid = addPlayerAt(world, spawn.x, spawn.y)
    TerrainState.kind[eid] = TERRAIN_KIND.cliff

    terrainHazardSystem(emptyCtx({ world }))

    expect(ARENA_CLIFF_COLLIDERS).toEqual([])
    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.land)
    expect(Position.x[eid]).toBe(spawn.x)
    expect(Position.y[eid]).toBe(spawn.y)
    expect(hasComponent(world, eid, NeedsWorldCollisionResolution)).toBe(false)
    expect(computePlayerAnimState(world, eid)).not.toBe("stumble")
    expect(computePlayerMoveState(world, eid)).not.toBe("rooted")
  })

  it("has no native cliff terrain to slide players from", () => {
    expect(ARENA_CLIFF_COLLIDERS).toEqual([])
  })
})
