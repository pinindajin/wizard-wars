import { addComponent, addEntity, createWorld, hasComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  FireballTag,
  InvulnerableTag,
  Ownership,
  PlayerTag,
  Position,
  Velocity,
} from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { SimCtx } from "../simulation"
import { projectileCollisionSystem } from "./projectileCollisionSystem"

function emptyCtx(overrides: Partial<SimCtx> = {}): SimCtx {
  return {
    world: createWorld(),
    currentTick: 20,
    serverTimeMs: Date.now(),
    playerEntityMap: new Map(),
    entityPlayerMap: new Map(),
    playerUsernameMap: new Map(),
    entityUsernameMap: new Map(),
    playerHeroIdMap: new Map(),
    fireballOwnerMap: new Map(),
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
    damageFloats: [],
    goldUpdates: [],
    matchEnded: null,
    hostEndSignal: false,
    prevPlayerStates: new Map(),
    prevFireballStates: new Map(),
    killStats: new Map(),
    playerDeltas: [],
    fireballDeltas: [],
    ...overrides,
  }
}

function addPlayer(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const eid = addEntity(world)
  addComponent(world, eid, PlayerTag)
  addComponent(world, eid, Position)
  Position.x[eid] = x
  Position.y[eid] = y
  return eid
}

function addFireball(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const eid = addEntity(world)
  addComponent(world, eid, FireballTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, Velocity)
  addComponent(world, eid, Ownership)
  Position.x[eid] = x
  Position.y[eid] = y
  Velocity.vx[eid] = 0
  Velocity.vy[eid] = 1
  return eid
}

describe("projectileCollisionSystem", () => {
  it("hits the character hitbox even when the old player circle would miss", () => {
    const world = createWorld()
    const target = addPlayer(world, 100, 100)
    const fireball = addFireball(world, 100, 55)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([[target, "target"]]),
      fireballOwnerMap: new Map([[fireball, "caster"]]),
    })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(1)
    expect(ctx.damageRequests[0]!.targetEid).toBe(target)
    expect(ctx.fireballImpacts[0]!.targetId).toBe("target")
  })

  it("misses when the fireball is outside the character hitbox", () => {
    const world = createWorld()
    addPlayer(world, 100, 100)
    addFireball(world, 100, 51.99)
    const ctx = emptyCtx({ world })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
    expect(ctx.fireballImpacts).toHaveLength(0)
  })

  it("does not damage invulnerable players", () => {
    const world = createWorld()
    const target = addPlayer(world, 100, 100)
    addComponent(world, target, InvulnerableTag)
    addFireball(world, 100, 55)
    const ctx = emptyCtx({ world })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
    expect(hasComponent(world, target, InvulnerableTag)).toBe(true)
  })
})
