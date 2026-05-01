import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  Equipment,
  Facing,
  JumpArc,
  MoveFacing,
  PlayerInput,
  PlayerTag,
  Position,
  Velocity,
} from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { SimCtx } from "../simulation"
import { ARENA_CENTER_X, ARENA_CENTER_Y } from "../../../shared/balance-config/arena"
import { JUMP_AIRBORNE_COLLIDER_EPSILON_PX } from "../../../shared/balance-config/combat"
import { movementSystem } from "./movementSystem"

/**
 * Builds a minimal {@link SimCtx} for unit tests that only run movementSystem.
 *
 * @param overrides - Partial context merged over defaults.
 * @returns A valid simulation context.
 */
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
    abilitySfxEvents: [],
    ...overrides,
  }
}

describe("movementSystem with JumpArc", () => {
  it("applies horizontal WASD movement while airborne (no lift-phase root)", () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, Facing)
    addComponent(world, eid, MoveFacing)
    addComponent(world, eid, PlayerInput)
    addComponent(world, eid, Equipment)
    addComponent(world, eid, JumpArc)

    Position.x[eid] = ARENA_CENTER_X
    Position.y[eid] = ARENA_CENTER_Y
    Facing.angle[eid] = 0
    MoveFacing.angle[eid] = 0
    Equipment.hasSwiftBoots[eid] = 0
    PlayerInput.right[eid] = 1
    PlayerInput.up[eid] = 0
    PlayerInput.down[eid] = 0
    PlayerInput.left[eid] = 0
    PlayerInput.weaponTargetX[eid] = ARENA_CENTER_X + 100
    PlayerInput.weaponTargetY[eid] = ARENA_CENTER_Y

    JumpArc.z[eid] = JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 50
    JumpArc.vz[eid] = 400

    const ctx = emptyCtx({ world, currentTick: 0 })
    const x0 = Position.x[eid]

    movementSystem(ctx)

    expect(Position.x[eid]).toBeGreaterThan(x0)
    expect(Velocity.vx[eid]).toBeGreaterThan(0)
  })
})
