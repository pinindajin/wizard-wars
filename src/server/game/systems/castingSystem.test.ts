import { addComponent, addEntity, createWorld, hasComponent } from "bitecs"
import { afterEach, describe, expect, it } from "vitest"

import {
  ABILITY_INDEX,
  AbilitySlots,
  Casting,
  Cooldown,
  Facing,
  Hero,
  PlayerInput,
  PlayerTag,
  Position,
  Velocity,
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
    activeMeleeAttacks: new Map(),
    playerDeltas: [],
    fireballDeltas: [],
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
  addComponent(world, eid, AbilitySlots)
  addComponent(world, eid, PlayerInput)
  Position.x[eid] = x
  Position.y[eid] = y
  Facing.angle[eid] = Math.PI
  Hero.typeIndex[eid] = 0
  Cooldown.fireball[eid] = 0
  Cooldown.lightningBolt[eid] = 0
  Cooldown.healingPotion[eid] = 0
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

describe("castingSystem animation timing", () => {
  afterEach(() => {
    ANIMATION_CONFIG.heroes.red_wizard.actions["spell:fireball"] =
      structuredClone(originalFireballConfig) as AnimationActionConfig
  })

  it("fires fireball from press-time position and target-derived facing", () => {
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
    expect(ctx.fireballLaunches[0]!.x).toBeCloseTo(125)
    expect(ctx.fireballLaunches[0]!.y).toBeCloseTo(100)
    expect(ctx.fireballLaunches[0]!.vx).toBeGreaterThan(0)
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

  it("queues lightning with press-time target even if input changes before release", () => {
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
    PlayerInput.abilitySlot[caster] = -1
    PlayerInput.abilityTargetX[caster] = 999
    PlayerInput.abilityTargetY[caster] = 999

    ctx.currentTick =
      10 + msToTickOffset(getSpellAnimationConfig("red_wizard", "lightning_bolt").durationMs)
    castingSystem(ctx)

    expect(ctx.pendingLightningBolts).toHaveLength(1)
    expect(ctx.pendingLightningBolts[0]!.targetX).toBe(300)
    expect(ctx.pendingLightningBolts[0]!.targetY).toBe(250)
  })
})
