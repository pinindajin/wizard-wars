import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, it, expect } from "vitest"

import {
  Cooldown,
  Equipment,
  Facing,
  PlayerInput,
  PlayerTag,
  Position,
} from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { SimCtx } from "../simulation"
import { primaryMeleeAttackSystem } from "./primaryMeleeAttackSystem"

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

describe("primaryMeleeAttackSystem", () => {
  it("emits casterId empty string when entityPlayerMap has no entry for the attacker", () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    addComponent(world, eid, Facing)
    addComponent(world, eid, Equipment)
    addComponent(world, eid, Cooldown)
    addComponent(world, eid, PlayerInput)

    Position.x[eid] = 100
    Position.y[eid] = 100
    Facing.angle[eid] = 0
    Equipment.primaryMeleeAttackIndex[eid] = 0
    Cooldown.primaryMelee[eid] = 0
    PlayerInput.weaponPrimary[eid] = 1

    const primaryMeleeAttacks: SimCtx["primaryMeleeAttacks"] = []
    const ctx = emptyCtx({ world, primaryMeleeAttacks })
    primaryMeleeAttackSystem(ctx)
    expect(primaryMeleeAttacks).toHaveLength(1)
    expect(primaryMeleeAttacks[0]!.casterId).toBe("")
  })

  it("hits a character hitbox even when the target center is outside swing radius", () => {
    const world = createWorld()
    const attacker = addEntity(world)
    addComponent(world, attacker, PlayerTag)
    addComponent(world, attacker, Position)
    addComponent(world, attacker, Facing)
    addComponent(world, attacker, Equipment)
    addComponent(world, attacker, Cooldown)
    addComponent(world, attacker, PlayerInput)

    Position.x[attacker] = 0
    Position.y[attacker] = 100
    Facing.angle[attacker] = 0
    Equipment.primaryMeleeAttackIndex[attacker] = 0
    Cooldown.primaryMelee[attacker] = 0
    PlayerInput.weaponPrimary[attacker] = 1

    const target = addEntity(world)
    addComponent(world, target, PlayerTag)
    addComponent(world, target, Position)
    Position.x[target] = 90
    Position.y[target] = 100

    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([
        [attacker, "attacker"],
        [target, "target"],
      ]),
    })
    primaryMeleeAttackSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(1)
    expect(ctx.damageRequests[0]!.targetEid).toBe(target)
    expect(ctx.primaryMeleeAttacks[0]!.hitPlayerIds).toEqual(["target"])
  })

  it("misses when the character hitbox is outside the swing cone", () => {
    const world = createWorld()
    const attacker = addEntity(world)
    addComponent(world, attacker, PlayerTag)
    addComponent(world, attacker, Position)
    addComponent(world, attacker, Facing)
    addComponent(world, attacker, Equipment)
    addComponent(world, attacker, Cooldown)
    addComponent(world, attacker, PlayerInput)

    Position.x[attacker] = 0
    Position.y[attacker] = 100
    Facing.angle[attacker] = Math.PI
    Equipment.primaryMeleeAttackIndex[attacker] = 0
    Cooldown.primaryMelee[attacker] = 0
    PlayerInput.weaponPrimary[attacker] = 1

    const target = addEntity(world)
    addComponent(world, target, PlayerTag)
    addComponent(world, target, Position)
    Position.x[target] = 90
    Position.y[target] = 100

    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([
        [attacker, "attacker"],
        [target, "target"],
      ]),
    })
    primaryMeleeAttackSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
    expect(ctx.primaryMeleeAttacks[0]!.hitPlayerIds).toEqual([])
  })
})
