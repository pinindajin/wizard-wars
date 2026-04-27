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
})
