import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, it, expect } from "vitest"

import {
  Cooldown,
  DeadTag,
  Equipment,
  Facing,
  PlayerInput,
  PlayerTag,
  Position,
  SpectatorTag,
} from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { ActiveMeleeAttack, SimCtx } from "../simulation"
import { primaryMeleeAttackSystem } from "./primaryMeleeAttackSystem"
import { PRIMARY_MELEE_ATTACK_CONFIGS } from "../../../shared/balance-config/equipment"
import { TICK_MS } from "../../../shared/balance-config"

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
    activeMeleeAttacks: new Map(),
    playerDeltas: [],
    fireballDeltas: [],
    ...overrides,
  }
}

function addAttacker(world: ReturnType<typeof createWorld>, x: number, y: number, facing = 0) {
  const eid = addEntity(world)
  addComponent(world, eid, PlayerTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, Facing)
  addComponent(world, eid, Equipment)
  addComponent(world, eid, Cooldown)
  addComponent(world, eid, PlayerInput)
  Position.x[eid] = x
  Position.y[eid] = y
  Facing.angle[eid] = facing
  Equipment.primaryMeleeAttackIndex[eid] = 0
  Cooldown.primaryMelee[eid] = 0
  PlayerInput.weaponPrimary[eid] = 1
  return eid
}

function addTarget(world: ReturnType<typeof createWorld>, x: number, y: number) {
  const eid = addEntity(world)
  addComponent(world, eid, PlayerTag)
  addComponent(world, eid, Position)
  Position.x[eid] = x
  Position.y[eid] = y
  return eid
}

describe("primaryMeleeAttackSystem", () => {
  it("emits a payload on the input tick and registers an active attack", () => {
    const world = createWorld()
    const eid = addAttacker(world, 100, 100)
    const ctx = emptyCtx({
      world,
      currentTick: 20,
      entityPlayerMap: new Map([[eid, "attacker"]]),
    })

    primaryMeleeAttackSystem(ctx)

    expect(ctx.primaryMeleeAttacks).toHaveLength(1)
    const swing = ctx.primaryMeleeAttacks[0]!
    expect(swing.casterId).toBe("attacker")
    expect(swing.attackId).toBe("red_wizard_cleaver")
    expect(swing.hurtboxRadiusPx).toBeGreaterThan(0)
    expect(swing.hurtboxArcDeg).toBeGreaterThan(0)
    expect(swing.dangerousWindowStartMs).toBeGreaterThanOrEqual(0)
    expect(swing.dangerousWindowEndMs).toBeGreaterThan(swing.dangerousWindowStartMs)

    expect(ctx.activeMeleeAttacks.size).toBe(1)
    const active = ctx.activeMeleeAttacks.get(eid)!
    expect(active.attackId).toBe("red_wizard_cleaver")
    expect(active.startTick).toBe(20)
    expect(active.facingAngle).toBe(0)
    expect(active.hitTargets.size).toBe(0)
  })

  it("uses empty caster id when the entity-player map has no entry", () => {
    const world = createWorld()
    addAttacker(world, 100, 100)
    const ctx = emptyCtx({ world, currentTick: 20 })

    primaryMeleeAttackSystem(ctx)

    expect(ctx.primaryMeleeAttacks[0]!.casterId).toBe("")
  })

  it("does not queue damage on the input tick (damage gates on dangerous window)", () => {
    const world = createWorld()
    const attacker = addAttacker(world, 0, 100)
    addTarget(world, 30, 100)
    const ctx = emptyCtx({
      world,
      currentTick: 0,
      entityPlayerMap: new Map([[attacker, "a"]]),
    })

    primaryMeleeAttackSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
  })

  it("queues damage exactly once when target is in hurtbox during dangerous window", () => {
    const world = createWorld()
    const attacker = addAttacker(world, 0, 100)
    const target = addTarget(world, 30, 100)
    const cfg = PRIMARY_MELEE_ATTACK_CONFIGS.red_wizard_cleaver
    const startTick = 0
    const dangerousTick = startTick + Math.ceil(cfg.dangerousWindowStartMs / TICK_MS) + 1

    const active: ActiveMeleeAttack = {
      attackId: "red_wizard_cleaver",
      startTick,
      facingAngle: 0,
      casterUserId: "a",
      hitTargets: new Set(),
    }
    const activeMeleeAttacks = new Map<number, ActiveMeleeAttack>([[attacker, active]])

    PlayerInput.weaponPrimary[attacker] = 0
    Cooldown.primaryMelee[attacker] = startTick + Math.ceil(cfg.durationMs / TICK_MS)

    const ctx = emptyCtx({
      world,
      currentTick: dangerousTick,
      activeMeleeAttacks,
      entityPlayerMap: new Map([[attacker, "a"]]),
    })

    primaryMeleeAttackSystem(ctx)
    expect(ctx.damageRequests).toHaveLength(1)
    expect(ctx.damageRequests[0]!.targetEid).toBe(target)
    expect(active.hitTargets.has(target)).toBe(true)

    const ctx2 = emptyCtx({
      world,
      currentTick: dangerousTick + 1,
      activeMeleeAttacks,
      entityPlayerMap: new Map([[attacker, "a"]]),
    })
    primaryMeleeAttackSystem(ctx2)
    expect(ctx2.damageRequests).toHaveLength(0)
  })

  it("does not queue damage when target hitbox is outside the half-circle (behind attacker)", () => {
    const world = createWorld()
    const attacker = addAttacker(world, 0, 100, Math.PI)
    addTarget(world, 30, 100)
    const cfg = PRIMARY_MELEE_ATTACK_CONFIGS.red_wizard_cleaver

    const active: ActiveMeleeAttack = {
      attackId: "red_wizard_cleaver",
      startTick: 0,
      facingAngle: Math.PI,
      casterUserId: "a",
      hitTargets: new Set(),
    }
    const activeMeleeAttacks = new Map<number, ActiveMeleeAttack>([[attacker, active]])
    PlayerInput.weaponPrimary[attacker] = 0
    Cooldown.primaryMelee[attacker] = Math.ceil(cfg.durationMs / TICK_MS)

    const ctx = emptyCtx({
      world,
      currentTick: Math.ceil(cfg.dangerousWindowStartMs / TICK_MS) + 1,
      activeMeleeAttacks,
    })
    primaryMeleeAttackSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
  })

  it("removes the active attack after the swing duration elapses", () => {
    const world = createWorld()
    const attacker = addAttacker(world, 0, 100)
    const cfg = PRIMARY_MELEE_ATTACK_CONFIGS.red_wizard_cleaver

    const active: ActiveMeleeAttack = {
      attackId: "red_wizard_cleaver",
      startTick: 0,
      facingAngle: 0,
      casterUserId: "a",
      hitTargets: new Set(),
    }
    const activeMeleeAttacks = new Map<number, ActiveMeleeAttack>([[attacker, active]])
    PlayerInput.weaponPrimary[attacker] = 0
    Cooldown.primaryMelee[attacker] = Math.ceil(cfg.durationMs / TICK_MS)

    const ctx = emptyCtx({
      world,
      currentTick: Math.ceil(cfg.durationMs / TICK_MS) + 5,
      activeMeleeAttacks,
    })
    primaryMeleeAttackSystem(ctx)

    expect(activeMeleeAttacks.size).toBe(0)
  })

  it("does not resolve active-swing damage when caster is dead or spectator", () => {
    for (const component of [DeadTag, SpectatorTag]) {
      const world = createWorld()
      const attacker = addAttacker(world, 0, 100)
      addTarget(world, 30, 100)
      addComponent(world, attacker, component)
      const cfg = PRIMARY_MELEE_ATTACK_CONFIGS.red_wizard_cleaver
      const activeMeleeAttacks = new Map<number, ActiveMeleeAttack>([
        [
          attacker,
          {
            attackId: "red_wizard_cleaver",
            startTick: 0,
            facingAngle: 0,
            casterUserId: "a",
            hitTargets: new Set(),
          },
        ],
      ])
      PlayerInput.weaponPrimary[attacker] = 0

      const ctx = emptyCtx({
        world,
        currentTick: Math.ceil(cfg.dangerousWindowStartMs / TICK_MS) + 1,
        activeMeleeAttacks,
      })

      primaryMeleeAttackSystem(ctx)
      expect(ctx.damageRequests).toHaveLength(0)
    }
  })
})
