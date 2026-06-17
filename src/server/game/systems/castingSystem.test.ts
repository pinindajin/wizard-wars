import { addComponent, addEntity, createWorld, hasComponent, removeComponent } from "bitecs"
import { afterEach, describe, expect, it } from "vitest"

import {
  ABILITY_INDEX,
  AbilitySlots,
  AbilityRuntime,
  Casting,
  Cooldown,
  DyingTag,
  Facing,
  Hero,
  HomingOrb,
  HomingOrbTag,
  PlayerInput,
  PlayerTag,
  Position,
  Velocity,
  JumpArc,
} from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { SimCtx } from "../simulation"
import { castingSystem } from "./castingSystem"
import {
  ANIMATION_CONFIG,
  getSpellAnimationConfig,
  msToTickOffset,
  type AnimationActionConfig,
} from "../../../shared/balance-config/animationConfig"
import {
  HOMING_ORB_CHARGE_RECHARGE_MS,
  HOMING_ORB_MAX_CHARGES,
  JUMP_CHARGE_RECHARGE_MS,
  JUMP_MAX_CHARGES,
  TICK_MS,
} from "../../../shared/balance-config"

const originalFireballConfig = structuredClone(
  ANIMATION_CONFIG.heroes.red_wizard.actions["spell:fireball"],
)

function emptyCtx(overrides: Partial<SimCtx> = {}): SimCtx {
  return {
    world: createWorld(),
    currentTick: 10,
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
    abilitySfxEvents: [],
    ...overrides,
  }
}

function addCaster(world: ReturnType<typeof createWorld>, x = 100, y = 100): number {
  const eid = addEntity(world)
  addComponent(world, eid, PlayerTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, Velocity)
  addComponent(world, eid, Facing)
  addComponent(world, eid, Hero)
  addComponent(world, eid, Cooldown)
  addComponent(world, eid, AbilityRuntime)
  addComponent(world, eid, AbilitySlots)
  addComponent(world, eid, PlayerInput)
  Position.x[eid] = x
  Position.y[eid] = y
  Facing.angle[eid] = Math.PI
  Hero.typeIndex[eid] = 0
  Cooldown.fireball[eid] = 0
  Cooldown.lightningBolt[eid] = 0
  Cooldown.healingPotion[eid] = 0
  Cooldown.jump[eid] = 0
  Cooldown.homingOrb[eid] = 0
  AbilityRuntime.jumpCharges[eid] = JUMP_MAX_CHARGES
  AbilityRuntime.jumpRechargeReadyTick[eid] = 0
  AbilityRuntime.jumpRechargeEndsAtMs[eid] = 0
  AbilityRuntime.homingOrbCharges[eid] = HOMING_ORB_MAX_CHARGES
  AbilityRuntime.homingOrbRechargeReadyTick[eid] = 0
  AbilityRuntime.homingOrbRechargeEndsAtMs[eid] = 0
  AbilitySlots.slot0[eid] = ABILITY_INDEX.fireball
  AbilitySlots.slot1[eid] = ABILITY_INDEX.lightning_bolt
  AbilitySlots.slot2[eid] = -1
  AbilitySlots.slot3[eid] = -1
  AbilitySlots.slot4[eid] = -1
  PlayerInput.abilitySlot[eid] = 0
  PlayerInput.abilityTargetX[eid] = x + 200
  PlayerInput.abilityTargetY[eid] = y
  return eid
}

function addPassiveTarget(
  world: ReturnType<typeof createWorld>,
  x: number,
  y: number,
): number {
  const target = addCaster(world, x, y)
  PlayerInput.abilitySlot[target] = -1
  return target
}

describe("castingSystem homing orb charges and target lock", () => {
  const homingRechargeTicks = Math.ceil(HOMING_ORB_CHARGE_RECHARGE_MS / TICK_MS)

  function addHomingCaster(world: ReturnType<typeof createWorld>): number {
    const caster = addCaster(world)
    AbilitySlots.slot2[caster] = ABILITY_INDEX.homing_orb
    PlayerInput.abilitySlot[caster] = 2
    return caster
  }

  it("casts homing orb without a target and spends a charge", () => {
    const world = createWorld()
    const caster = addHomingCaster(world)
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      currentTick: 20,
      serverTimeMs: 1_000,
      commandBuffer,
      entityPlayerMap: new Map([[caster, "caster"]]),
    })

    castingSystem(ctx)

    expect(hasComponent(world, caster, Casting)).toBe(true)
    expect(AbilityRuntime.homingOrbCharges[caster]).toBe(HOMING_ORB_MAX_CHARGES - 1)
    expect(AbilityRuntime.homingOrbRechargeReadyTick[caster]).toBe(20 + homingRechargeTicks)

    PlayerInput.abilitySlot[caster] = -1
    ctx.currentTick =
      20 + msToTickOffset(getSpellAnimationConfig("red_wizard", "homing_orb").durationMs)
    castingSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.homingOrbLaunches).toHaveLength(1)
    expect(ctx.homingOrbLaunches[0]!.ownerId).toBe("caster")
    expect(ctx.homingOrbLaunches[0]).not.toHaveProperty("targetId")
    expect(hasComponent(world, ctx.homingOrbLaunches[0]!.id, HomingOrbTag)).toBe(true)
    expect(HomingOrb.targetEid[ctx.homingOrbLaunches[0]!.id]).toBe(-1)
    expect(ctx.homingOrbTargetPlayerMap.has(ctx.homingOrbLaunches[0]!.id)).toBe(false)
  })

  it("spends a charge and launches at the target closest to the captured cursor", () => {
    const world = createWorld()
    const caster = addHomingCaster(world)
    const far = addPassiveTarget(world, 500, 100)
    const nearCursor = addPassiveTarget(world, 280, 100)
    PlayerInput.abilityTargetX[caster] = 300
    PlayerInput.abilityTargetY[caster] = 100
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      currentTick: 10,
      serverTimeMs: 1_000,
      commandBuffer,
      entityPlayerMap: new Map([
        [caster, "caster"],
        [far, "far"],
        [nearCursor, "near"],
      ]),
    })

    castingSystem(ctx)

    expect(hasComponent(world, caster, Casting)).toBe(true)
    expect(AbilityRuntime.homingOrbCharges[caster]).toBe(HOMING_ORB_MAX_CHARGES - 1)
    expect(AbilityRuntime.homingOrbRechargeReadyTick[caster]).toBe(10 + homingRechargeTicks)

    PlayerInput.abilitySlot[caster] = -1
    ctx.currentTick =
      10 + msToTickOffset(getSpellAnimationConfig("red_wizard", "homing_orb").durationMs)
    castingSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.homingOrbLaunches).toHaveLength(1)
    expect(ctx.homingOrbLaunches[0]!.ownerId).toBe("caster")
    expect(ctx.homingOrbLaunches[0]!.targetId).toBe("near")
    expect(hasComponent(world, ctx.homingOrbLaunches[0]!.id, HomingOrbTag)).toBe(true)
    expect(HomingOrb.targetEid[ctx.homingOrbLaunches[0]!.id]).toBe(nearCursor)
  })
})

describe("castingSystem jump charges", () => {
  const jumpRechargeTicks = Math.ceil(JUMP_CHARGE_RECHARGE_MS / TICK_MS)

  function addJumpCaster(world: ReturnType<typeof createWorld>): number {
    const caster = addCaster(world)
    AbilitySlots.slot2[caster] = ABILITY_INDEX.jump
    PlayerInput.abilitySlot[caster] = 2
    return caster
  }

  it("spends one charge and starts a recharge timer on accepted jump", () => {
    const world = createWorld()
    const caster = addJumpCaster(world)
    const ctx = emptyCtx({
      world,
      currentTick: 20,
      serverTimeMs: 1_000,
    })

    castingSystem(ctx)

    expect(hasComponent(world, caster, JumpArc)).toBe(true)
    expect(AbilityRuntime.jumpCharges[caster]).toBe(JUMP_MAX_CHARGES - 1)
    expect(AbilityRuntime.jumpRechargeReadyTick[caster]).toBe(20 + jumpRechargeTicks)
    expect(AbilityRuntime.jumpRechargeEndsAtMs[caster]).toBeCloseTo(
      1_000 + jumpRechargeTicks * TICK_MS,
    )
    expect(Cooldown.jump[caster]).toBe(0)
    expect(ctx.abilitySfxEvents).toEqual([{ sfxKey: "sfx-jump" }])
  })

  it("allows another jump before recharge completes when a charge remains", () => {
    const world = createWorld()
    const caster = addJumpCaster(world)
    const ctx = emptyCtx({
      world,
      currentTick: 20,
      serverTimeMs: 1_000,
    })

    castingSystem(ctx)
    const firstRechargeTick = AbilityRuntime.jumpRechargeReadyTick[caster]
    removeComponent(world, caster, JumpArc)
    PlayerInput.abilitySlot[caster] = 2
    ctx.currentTick = 21
    ctx.serverTimeMs = 1_000 + TICK_MS
    ctx.abilitySfxEvents = []

    castingSystem(ctx)

    expect(hasComponent(world, caster, JumpArc)).toBe(true)
    expect(AbilityRuntime.jumpCharges[caster]).toBe(JUMP_MAX_CHARGES - 2)
    expect(AbilityRuntime.jumpRechargeReadyTick[caster]).toBe(firstRechargeTick)
    expect(ctx.abilitySfxEvents).toEqual([{ sfxKey: "sfx-jump" }])
  })

  it("rejects zero-charge jump without arc, charge consumption, or sfx", () => {
    const world = createWorld()
    const caster = addJumpCaster(world)
    AbilityRuntime.jumpCharges[caster] = 0
    AbilityRuntime.jumpRechargeReadyTick[caster] = 1_000
    AbilityRuntime.jumpRechargeEndsAtMs[caster] = 20_000
    const ctx = emptyCtx({
      world,
      currentTick: 20,
      serverTimeMs: 1_000,
    })

    castingSystem(ctx)

    expect(hasComponent(world, caster, JumpArc)).toBe(false)
    expect(AbilityRuntime.jumpCharges[caster]).toBe(0)
    expect(AbilityRuntime.jumpRechargeReadyTick[caster]).toBe(1_000)
    expect(ctx.abilitySfxEvents).toEqual([])
  })

  it("restores a charge before validating same-tick jump input", () => {
    const world = createWorld()
    const caster = addJumpCaster(world)
    AbilityRuntime.jumpCharges[caster] = 0
    AbilityRuntime.jumpRechargeReadyTick[caster] = 50
    AbilityRuntime.jumpRechargeEndsAtMs[caster] = 5_000
    const ctx = emptyCtx({
      world,
      currentTick: 50,
      serverTimeMs: 5_000,
    })

    castingSystem(ctx)

    expect(hasComponent(world, caster, JumpArc)).toBe(true)
    expect(AbilityRuntime.jumpCharges[caster]).toBe(0)
    expect(AbilityRuntime.jumpRechargeReadyTick[caster]).toBe(50 + jumpRechargeTicks)
    expect(ctx.abilitySfxEvents).toEqual([{ sfxKey: "sfx-jump" }])
  })
})

describe("castingSystem animation timing", () => {
  afterEach(() => {
    ANIMATION_CONFIG.heroes.red_wizard.actions["spell:fireball"] =
      structuredClone(originalFireballConfig) as AnimationActionConfig
  })

  it("fires fireball from effect-time feet with press-locked aim", () => {
    const world = createWorld()
    const caster = addCaster(world)
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      currentTick: 10,
      commandBuffer,
      entityPlayerMap: new Map([[caster, "caster"]]),
    })

    castingSystem(ctx)
    expect(hasComponent(world, caster, Casting)).toBe(true)

    Position.x[caster] = 500
    Position.y[caster] = 500
    Facing.angle[caster] = Math.PI
    PlayerInput.abilitySlot[caster] = -1
    PlayerInput.abilityTargetX[caster] = 0
    PlayerInput.abilityTargetY[caster] = 0

    ctx.currentTick =
      10 + msToTickOffset(getSpellAnimationConfig("red_wizard", "fireball").durationMs)
    castingSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.fireballLaunches).toHaveLength(1)
    expect(ctx.fireballLaunches[0]!.x).toBeCloseTo(525)
    expect(ctx.fireballLaunches[0]!.y).toBeCloseTo(500)
    expect(ctx.fireballLaunches[0]!.vx).toBeGreaterThan(0)
    expect(ctx.fireballCreatedAtTickMap.get(ctx.fireballLaunches[0]!.id)).toBe(
      ctx.currentTick,
    )
  })

  it("does not spawn fireball when caster is dying before command buffer execute", () => {
    const world = createWorld()
    const caster = addCaster(world)
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      currentTick: 10,
      commandBuffer,
      entityPlayerMap: new Map([[caster, "caster"]]),
    })

    castingSystem(ctx)
    Position.x[caster] = 500
    Position.y[caster] = 500
    PlayerInput.abilitySlot[caster] = -1

    ctx.currentTick =
      10 + msToTickOffset(getSpellAnimationConfig("red_wizard", "fireball").durationMs)
    castingSystem(ctx)
    addComponent(world, caster, DyingTag)
    commandBuffer.execute(world)

    expect(ctx.fireballLaunches).toHaveLength(0)
    expect(ctx.fireballOwnerMap.size).toBe(0)
    expect(ctx.fireballCreatedAtTickMap.size).toBe(0)
  })

  it("can fire a spell effect before the animation finishes", () => {
    ANIMATION_CONFIG.heroes.red_wizard.actions["spell:fireball"] = {
      type: "spell",
      durationMs: 500,
      effectTiming: "before",
    }
    const world = createWorld()
    const caster = addCaster(world)
    const commandBuffer = createCommandBuffer()
    const ctx = emptyCtx({
      world,
      currentTick: 10,
      commandBuffer,
      entityPlayerMap: new Map([[caster, "caster"]]),
    })

    castingSystem(ctx)
    expect(ctx.fireballLaunches).toHaveLength(0)

    ctx.currentTick = 11
    castingSystem(ctx)
    commandBuffer.execute(world)

    expect(ctx.fireballLaunches).toHaveLength(1)
    expect(hasComponent(world, caster, Casting)).toBe(true)
    expect(Casting.animationEndsAtTick[caster]).toBe(10 + msToTickOffset(500))
  })

  it("queues lightning with press-time direction even if input changes before release", () => {
    const world = createWorld()
    const caster = addCaster(world)
    PlayerInput.abilitySlot[caster] = 1
    PlayerInput.abilityTargetX[caster] = 300
    PlayerInput.abilityTargetY[caster] = 250
    const ctx = emptyCtx({
      world,
      currentTick: 10,
      entityPlayerMap: new Map([[caster, "caster"]]),
    })

    castingSystem(ctx)
    expect(ctx.combatTelegraphStarts).toHaveLength(1)
    expect(ctx.combatTelegraphStarts[0]!.sourceId).toBe("lightning_bolt")
    expect(ctx.combatTelegraphStarts[0]!.shape.type).toBe("capsule")
    PlayerInput.abilitySlot[caster] = -1
    PlayerInput.abilityTargetX[caster] = 999
    PlayerInput.abilityTargetY[caster] = 999

    ctx.currentTick =
      10 + msToTickOffset(getSpellAnimationConfig("red_wizard", "lightning_bolt").durationMs)
    castingSystem(ctx)

    expect(ctx.pendingLightningBolts).toHaveLength(1)
    expect(ctx.pendingLightningBolts[0]!.directionRad).toBeCloseTo(Math.atan2(150, 200))
    expect(ctx.combatTelegraphEnds).toContainEqual({
      id: ctx.combatTelegraphStarts[0]!.id,
      reason: "expired",
    })
    expect(ctx.activeCombatTelegraphs.size).toBe(0)
  })

  it("cancels a lightning telegraph without firing when the caster dies", () => {
    const world = createWorld()
    const caster = addCaster(world)
    PlayerInput.abilitySlot[caster] = 1
    const ctx = emptyCtx({
      world,
      currentTick: 10,
      entityPlayerMap: new Map([[caster, "caster"]]),
    })

    castingSystem(ctx)
    addComponent(world, caster, DyingTag)
    PlayerInput.abilitySlot[caster] = -1
    ctx.currentTick = 11
    castingSystem(ctx)

    expect(ctx.pendingLightningBolts).toHaveLength(0)
    expect(ctx.combatTelegraphEnds).toContainEqual({
      id: ctx.combatTelegraphStarts[0]!.id,
      reason: "caster_dead",
    })
  })
})
