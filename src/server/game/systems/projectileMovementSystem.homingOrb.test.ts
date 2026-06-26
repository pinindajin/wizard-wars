import { addComponent, addEntity, createWorld, hasComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  DeadTag,
  FireballTag,
  HomingOrb,
  HomingOrbTag,
  Ownership,
  PlayerTag,
  Position,
  ProjectileTag,
  Velocity,
} from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { SimCtx } from "../simulation"
import {
  HOMING_ORB_EXPIRY_DAMAGE,
  HOMING_ORB_MAX_SPEED_PX_PER_SEC,
  HOMING_ORB_TURN_DECEL_PX_PER_SEC2,
  HOMING_ORB_TURN_RATE_DEG_PER_SEC,
  TICK_DT_SEC,
} from "../../../shared/balance-config"
import { projectileMovementSystem } from "./projectileMovementSystem"

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

/**
 * Adds one Fireball projectile entity to the test world.
 *
 * @param world - ECS world.
 * @param x - Initial x coordinate.
 * @param y - Initial y coordinate.
 * @returns Fireball entity id.
 */
function addFireball(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const eid = addEntity(world)
  addComponent(world, eid, FireballTag)
  addComponent(world, eid, ProjectileTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, Velocity)
  Position.x[eid] = x
  Position.y[eid] = y
  Velocity.vx[eid] = 0
  Velocity.vy[eid] = 0
  return eid
}

function addOrb(
  world: ReturnType<typeof createWorld>,
  owner: number,
  target: number,
  headingRad: number,
  speedPxPerSec: number,
  expiresAtTick = 999,
): number {
  const eid = addEntity(world)
  addComponent(world, eid, HomingOrbTag)
  addComponent(world, eid, ProjectileTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, Velocity)
  addComponent(world, eid, Ownership)
  addComponent(world, eid, HomingOrb)
  Position.x[eid] = 100
  Position.y[eid] = 100
  Ownership.ownerEid[eid] = owner
  HomingOrb.targetEid[eid] = target
  HomingOrb.headingRad[eid] = headingRad
  HomingOrb.speedPxPerSec[eid] = speedPxPerSec
  HomingOrb.expiresAtTick[eid] = expiresAtTick
  return eid
}

describe("projectileMovementSystem fireballs", () => {
  it("cleans previous fireball state when an out-of-bounds fireball despawns", () => {
    const world = createWorld()
    const fireball = addFireball(world, -10_000, 100)
    const ctx = emptyCtx({
      world,
      fireballOwnerMap: new Map([[fireball, "caster"]]),
      fireballCreatedAtTickMap: new Map([[fireball, 10]]),
      prevFireballStates: new Map([[fireball, { x: -10_000, y: 100 }]]),
    })

    projectileMovementSystem(ctx)

    expect(ctx.fireballRemovedIds).toEqual([fireball])
    expect(ctx.fireballOwnerMap.has(fireball)).toBe(false)
    expect(ctx.fireballCreatedAtTickMap.has(fireball)).toBe(false)
    expect(ctx.prevFireballStates.has(fireball)).toBe(false)
  })
})

describe("projectileMovementSystem homing orbs", () => {
  it("accelerates within the front cone without exceeding max speed", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const target = addPlayer(world, 1_000, 100)
    const orb = addOrb(world, owner, target, 0, HOMING_ORB_MAX_SPEED_PX_PER_SEC - 1)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [target, "target"],
      ]),
      homingOrbOwnerMap: new Map([[orb, "caster"]]),
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })

    projectileMovementSystem(ctx)

    expect(HomingOrb.speedPxPerSec[orb]).toBe(HOMING_ORB_MAX_SPEED_PX_PER_SEC)
    expect(Velocity.vx[orb]).toBeCloseTo(HOMING_ORB_MAX_SPEED_PX_PER_SEC)
  })

  it("turns at the configured rate and decelerates while outside the cone", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const target = addPlayer(world, 100, 1_000)
    const orb = addOrb(world, owner, target, 0, 120)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [target, "target"],
      ]),
      homingOrbOwnerMap: new Map([[orb, "caster"]]),
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })

    projectileMovementSystem(ctx)

    expect(HomingOrb.headingRad[orb]).toBeCloseTo(
      (HOMING_ORB_TURN_RATE_DEG_PER_SEC * Math.PI / 180) * TICK_DT_SEC,
      5,
    )
    expect(HomingOrb.speedPxPerSec[orb]).toBeCloseTo(
      120 - HOMING_ORB_TURN_DECEL_PX_PER_SEC2 * TICK_DT_SEC,
      5,
    )
  })

  it("retargets by nearest valid enemy when the locked target is dead", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const deadTarget = addPlayer(world, 300, 100)
    const nearest = addPlayer(world, 130, 100)
    const farther = addPlayer(world, 220, 100)
    addComponent(world, deadTarget, DeadTag)
    const orb = addOrb(world, owner, deadTarget, 0, 120)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [deadTarget, "dead"],
        [nearest, "nearest"],
        [farther, "farther"],
      ]),
      homingOrbOwnerMap: new Map([[orb, "caster"]]),
      homingOrbTargetPlayerMap: new Map([[orb, "dead"]]),
    })

    projectileMovementSystem(ctx)

    expect(HomingOrb.targetEid[orb]).toBe(nearest)
    expect(ctx.homingOrbTargetPlayerMap.get(orb)).toBe("nearest")
  })

  it("retargeting skips non-owner entities with the owner user id", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const deadTarget = addPlayer(world, 300, 100)
    const duplicateOwnerUser = addPlayer(world, 120, 100)
    const nearestEnemy = addPlayer(world, 130, 100)
    addComponent(world, deadTarget, DeadTag)
    const orb = addOrb(world, owner, deadTarget, 0, 120)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [deadTarget, "dead"],
        [duplicateOwnerUser, "caster"],
        [nearestEnemy, "nearest"],
      ]),
      homingOrbOwnerMap: new Map([[orb, "caster"]]),
      homingOrbTargetPlayerMap: new Map([[orb, "dead"]]),
    })

    projectileMovementSystem(ctx)

    expect(HomingOrb.targetEid[orb]).toBe(nearestEnemy)
    expect(ctx.homingOrbTargetPlayerMap.get(orb)).toBe("nearest")
  })

  it("retargets to the nearest valid player when owner user id is missing", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const deadTarget = addPlayer(world, 300, 100)
    const nearest = addPlayer(world, 130, 100)
    const farther = addPlayer(world, 220, 100)
    addComponent(world, deadTarget, DeadTag)
    const orb = addOrb(world, owner, deadTarget, 0, 120)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [deadTarget, "dead"],
        [nearest, "nearest"],
        [farther, "farther"],
      ]),
      homingOrbTargetPlayerMap: new Map([[orb, "dead"]]),
    })

    projectileMovementSystem(ctx)

    expect(HomingOrb.targetEid[orb]).toBe(nearest)
    expect(ctx.homingOrbTargetPlayerMap.get(orb)).toBe("nearest")
  })

  it("expires in place and deals half damage to valid enemies in radius", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const target = addPlayer(world, 100, 100)
    const orb = addOrb(world, owner, target, 0, 120, 20)
    Position.x[orb] = 100
    Position.y[orb] = 55
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      commandBuffer,
      currentTick: 20,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [target, "target"],
      ]),
      homingOrbOwnerMap: new Map([[orb, "caster"]]),
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })

    projectileMovementSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.damageRequests).toContainEqual({
      targetEid: target,
      damage: HOMING_ORB_EXPIRY_DAMAGE,
      killerUserId: "caster",
      killerAbilityId: "homing_orb",
    })
    expect(ctx.homingOrbImpacts[0]).toMatchObject({
      id: orb,
      reason: "expired",
      hitPlayerIds: ["target"],
      damage: HOMING_ORB_EXPIRY_DAMAGE,
    })
    expect(ctx.homingOrbRemovedIds).toEqual([orb])
    expect(hasComponent(world, orb, HomingOrbTag)).toBe(false)
  })

  it("expiry damage can hit targets when owner user id is missing", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const target = addPlayer(world, 100, 100)
    const orb = addOrb(world, owner, target, 0, 120, 20)
    Position.x[orb] = 100
    Position.y[orb] = 55
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      commandBuffer,
      currentTick: 20,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [target, "target"],
      ]),
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })

    projectileMovementSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.damageRequests).toContainEqual({
      targetEid: target,
      damage: HOMING_ORB_EXPIRY_DAMAGE,
      killerUserId: null,
      killerAbilityId: "homing_orb",
    })
    expect(ctx.homingOrbImpacts[0]).toMatchObject({
      id: orb,
      reason: "expired",
      hitPlayerIds: ["target"],
      damage: HOMING_ORB_EXPIRY_DAMAGE,
    })
    expect(hasComponent(world, orb, HomingOrbTag)).toBe(false)
  })

  it("expiry damage skips non-owner entities with the owner user id", () => {
    const world = createWorld()
    const owner = addPlayer(world, 0, 0)
    const duplicateOwnerUser = addPlayer(world, 100, 100)
    const target = addPlayer(world, 112, 100)
    const orb = addOrb(world, owner, target, 0, 120, 20)
    Position.x[orb] = 100
    Position.y[orb] = 55
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      commandBuffer,
      currentTick: 20,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [duplicateOwnerUser, "caster"],
        [target, "target"],
      ]),
      homingOrbOwnerMap: new Map([[orb, "caster"]]),
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })

    projectileMovementSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.damageRequests).toEqual([
      {
        targetEid: target,
        damage: HOMING_ORB_EXPIRY_DAMAGE,
        killerUserId: "caster",
        killerAbilityId: "homing_orb",
      },
    ])
    expect(ctx.damageRequests).not.toContainEqual(
      expect.objectContaining({ targetEid: duplicateOwnerUser }),
    )
    expect(ctx.homingOrbImpacts[0]?.hitPlayerIds).toEqual(["target"])
  })

  it("expiry damage skips the owner and misses enemies outside the radius", () => {
    const world = createWorld()
    const owner = addPlayer(world, 100, 100)
    const farTarget = addPlayer(world, 400, 400)
    const orb = addOrb(world, owner, owner, 0, 120, 20)
    Position.x[orb] = 100
    Position.y[orb] = 55
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      commandBuffer,
      currentTick: 20,
      entityPlayerMap: new Map([
        [owner, "caster"],
        [farTarget, "target"],
      ]),
      homingOrbOwnerMap: new Map([[orb, "caster"]]),
      homingOrbTargetPlayerMap: new Map([[orb, "caster"]]),
    })

    projectileMovementSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.damageRequests).toEqual([])
    expect(ctx.homingOrbImpacts[0]).toMatchObject({
      id: orb,
      reason: "expired",
      hitPlayerIds: [],
      damage: HOMING_ORB_EXPIRY_DAMAGE,
    })
    expect(ctx.homingOrbRemovedIds).toEqual([orb])
  })
})
