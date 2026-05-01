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
import {
  FIREBALL_OWNER_SELF_DAMAGE_GRACE_MS,
  TICK_MS,
} from "../../../shared/balance-config"
import { projectileCollisionSystem } from "./projectileCollisionSystem"

const FIREBALL_OWNER_SELF_DAMAGE_GRACE_TICKS = Math.ceil(
  FIREBALL_OWNER_SELF_DAMAGE_GRACE_MS / TICK_MS,
)

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
  it("does not damage the fireball owner during the launch grace window", () => {
    const world = createWorld()
    const owner = addPlayer(world, 100, 100)
    const fireball = addFireball(world, 100, 75)
    const ctx = emptyCtx({
      world,
      currentTick: 20,
      entityPlayerMap: new Map([[owner, "caster"]]),
      fireballOwnerMap: new Map([[fireball, "caster"]]),
      fireballCreatedAtTickMap: new Map([[fireball, 20]]),
    })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
    expect(ctx.fireballImpacts).toHaveLength(0)
    expect(ctx.fireballRemovedIds).toHaveLength(0)
    expect(ctx.fireballOwnerMap.get(fireball)).toBe("caster")
  })

  it("damages other players during the owner's launch grace window", () => {
    const world = createWorld()
    const target = addPlayer(world, 100, 100)
    const fireball = addFireball(world, 100, 75)
    const ctx = emptyCtx({
      world,
      currentTick: 20,
      entityPlayerMap: new Map([[target, "target"]]),
      fireballOwnerMap: new Map([[fireball, "caster"]]),
      fireballCreatedAtTickMap: new Map([[fireball, 20]]),
    })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(1)
    expect(ctx.damageRequests[0]!.targetEid).toBe(target)
    expect(ctx.fireballImpacts[0]!.targetId).toBe("target")
  })

  it("damages the fireball owner after the launch grace window expires", () => {
    const world = createWorld()
    const owner = addPlayer(world, 100, 100)
    const fireball = addFireball(world, 100, 75)
    const ctx = emptyCtx({
      world,
      currentTick: 20,
      entityPlayerMap: new Map([[owner, "caster"]]),
      fireballOwnerMap: new Map([[fireball, "caster"]]),
      fireballCreatedAtTickMap: new Map([
        [fireball, 20 - FIREBALL_OWNER_SELF_DAMAGE_GRACE_TICKS],
      ]),
    })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(1)
    expect(ctx.damageRequests[0]!.targetEid).toBe(owner)
    expect(ctx.fireballImpacts[0]!.targetId).toBe("caster")
    expect(ctx.fireballRemovedIds).toEqual([fireball])
    expect(ctx.fireballOwnerMap.has(fireball)).toBe(false)
    expect(ctx.fireballCreatedAtTickMap.has(fireball)).toBe(false)
  })

  it("keeps existing collision behavior when the fireball launch tick is missing", () => {
    const world = createWorld()
    const owner = addPlayer(world, 100, 100)
    const fireball = addFireball(world, 100, 75)
    const ctx = emptyCtx({
      world,
      currentTick: 20,
      entityPlayerMap: new Map([[owner, "caster"]]),
      fireballOwnerMap: new Map([[fireball, "caster"]]),
    })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(1)
    expect(ctx.damageRequests[0]!.targetEid).toBe(owner)
  })

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
