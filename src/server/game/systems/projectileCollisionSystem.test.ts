import { addComponent, addEntity, createWorld, hasComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  FireballTag,
  HomingOrb,
  HomingOrbTag,
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
  HOMING_ORB_DAMAGE,
  TICK_MS,
} from "../../../shared/balance-config"
import { ARENA_PROP_COLLIDERS } from "../../../shared/balance-config/arena"
import { projectileCollisionSystem } from "./projectileCollisionSystem"

const FIREBALL_OWNER_SELF_DAMAGE_GRACE_TICKS = Math.ceil(
  FIREBALL_OWNER_SELF_DAMAGE_GRACE_MS / TICK_MS,
)
const FIREBALL_TEST_RADIUS_PX = 8

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

function addHomingOrb(
  world: ReturnType<typeof createWorld>,
  x: number,
  y: number,
  targetEid: number,
  ownerEid = -1,
): number {
  const eid = addEntity(world)
  addComponent(world, eid, HomingOrbTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, Velocity)
  addComponent(world, eid, Ownership)
  addComponent(world, eid, HomingOrb)
  Position.x[eid] = x
  Position.y[eid] = y
  Velocity.vx[eid] = 120
  Velocity.vy[eid] = 0
  Ownership.ownerEid[eid] = ownerEid
  HomingOrb.targetEid[eid] = targetEid
  HomingOrb.headingRad[eid] = 0
  HomingOrb.speedPxPerSec[eid] = 120
  HomingOrb.expiresAtTick[eid] = 999
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

  it("preserves first overlapping fireball hit order when the first target is unmapped", () => {
    const world = createWorld()
    const unmappedTarget = addPlayer(world, 100, 100)
    const mappedTarget = addPlayer(world, 100, 100)
    const fireball = addFireball(world, 100, 75)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([[mappedTarget, "mapped"]]),
      fireballOwnerMap: new Map([[fireball, "caster"]]),
    })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(1)
    expect(ctx.damageRequests[0]!.targetEid).toBe(unmappedTarget)
    expect(ctx.fireballImpacts[0]!.targetId).toBeUndefined()
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

  it("despawns fireballs on props before damaging a player behind the prop", () => {
    const prop = ARENA_PROP_COLLIDERS[0]
    if (!prop) throw new Error("Expected generated arena prop collider")

    const world = createWorld()
    const x = prop.x + prop.width / 2
    const y = prop.y + prop.height / 2
    const target = addPlayer(world, x, y)
    const fireball = addFireball(world, x, y)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([[target, "target"]]),
      fireballOwnerMap: new Map([[fireball, "caster"]]),
    })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
    expect(ctx.fireballImpacts).toEqual([{ id: fireball, x, y }])
    expect(ctx.fireballRemovedIds).toEqual([fireball])
    expect(ctx.fireballOwnerMap.has(fireball)).toBe(false)
  })

  it("despawns fireballs when only the fireball radius touches a prop edge", () => {
    const prop = ARENA_PROP_COLLIDERS[0]
    if (!prop) throw new Error("Expected generated arena prop collider")

    const world = createWorld()
    const x = prop.x - FIREBALL_TEST_RADIUS_PX
    const y = prop.y + prop.height / 2
    const fireball = addFireball(world, x, y)
    const ctx = emptyCtx({
      world,
      fireballOwnerMap: new Map([[fireball, "caster"]]),
    })

    projectileCollisionSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
    expect(ctx.fireballImpacts).toEqual([{ id: fireball, x, y }])
    expect(ctx.fireballRemovedIds).toEqual([fireball])
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

  it("homing orb direct hit damages one enemy without knockback", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const target = addPlayer(world, 100, 100)
    const orb = addHomingOrb(world, 100, 55, target, owner)
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      commandBuffer,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [target, "target"],
      ]),
      homingOrbOwnerMap: new Map([[orb, "caster"]]),
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })

    projectileCollisionSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.damageRequests).toEqual([
      {
        targetEid: target,
        damage: HOMING_ORB_DAMAGE,
        killerUserId: "caster",
        killerAbilityId: "homing_orb",
      },
    ])
    expect(ctx.homingOrbImpacts[0]).toMatchObject({
      id: orb,
      reason: "hit",
      targetId: "target",
      damage: HOMING_ORB_DAMAGE,
    })
    expect(ctx.homingOrbRemovedIds).toEqual([orb])
    expect(hasComponent(world, orb, HomingOrbTag)).toBe(false)
  })

  it("homing orb direct hit can damage enemies when owner user id is missing", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const target = addPlayer(world, 100, 100)
    const orb = addHomingOrb(world, 100, 55, target, owner)
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      commandBuffer,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [target, "target"],
      ]),
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })

    projectileCollisionSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.damageRequests).toEqual([
      {
        targetEid: target,
        damage: HOMING_ORB_DAMAGE,
        killerUserId: null,
        killerAbilityId: "homing_orb",
      },
    ])
    expect(ctx.homingOrbImpacts[0]).toMatchObject({
      id: orb,
      reason: "hit",
      targetId: "target",
      damage: HOMING_ORB_DAMAGE,
    })
    expect(hasComponent(world, orb, HomingOrbTag)).toBe(false)
  })

  it("homing orb direct hit ignores its owner and keeps flying on misses", () => {
    const world = createWorld()
    const owner = addPlayer(world, 100, 100)
    const farTarget = addPlayer(world, 400, 400)
    const orb = addHomingOrb(world, 100, 55, owner, owner)
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      commandBuffer,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [farTarget, "target"],
      ]),
      homingOrbOwnerMap: new Map([[orb, "caster"]]),
      homingOrbTargetPlayerMap: new Map([[orb, "caster"]]),
    })

    projectileCollisionSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.damageRequests).toEqual([])
    expect(ctx.homingOrbImpacts).toEqual([])
    expect(ctx.homingOrbRemovedIds).toEqual([])
    expect(hasComponent(world, orb, HomingOrbTag)).toBe(true)
  })
})
