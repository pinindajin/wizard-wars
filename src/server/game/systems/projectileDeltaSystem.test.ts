import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  HomingOrb,
  HomingOrbTag,
  Position,
  Velocity,
} from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { SimCtx } from "../simulation"
import { projectileDeltaSystem } from "./projectileDeltaSystem"

function emptyCtx(overrides: Partial<SimCtx> = {}): SimCtx {
  return {
    world: createWorld(),
    currentTick: 1,
    serverTimeMs: 1_000,
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
    matchStartedAtMs: 0,
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

function addHomingOrb(world: ReturnType<typeof createWorld>): number {
  const eid = addEntity(world)
  addComponent(world, eid, HomingOrbTag)
  addComponent(world, eid, Position)
  addComponent(world, eid, Velocity)
  addComponent(world, eid, HomingOrb)
  Position.x[eid] = 10
  Position.y[eid] = 20
  Velocity.vx[eid] = 30
  Velocity.vy[eid] = 40
  HomingOrb.headingRad[eid] = 0.5
  return eid
}

describe("projectileDeltaSystem Homing Orb deltas", () => {
  it("seeds new Homing Orbs without emitting a launch-duplicate delta", () => {
    const world = createWorld()
    const orb = addHomingOrb(world)
    const ctx = emptyCtx({
      world,
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })

    projectileDeltaSystem(ctx)

    expect(ctx.homingOrbDeltas).toEqual([])
    expect(ctx.prevHomingOrbStates.get(orb)).toMatchObject({
      x: 10,
      y: 20,
      vx: 30,
      vy: 40,
      headingRad: 0.5,
      targetId: "target",
    })
  })

  it("emits only Homing Orb fields that changed since the previous tick", () => {
    const world = createWorld()
    const orb = addHomingOrb(world)
    const ctx = emptyCtx({
      world,
      prevHomingOrbStates: new Map([
        [orb, { x: 10, y: 20, vx: 30, vy: 40, headingRad: 0.5, targetId: "target" }],
      ]),
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })
    Position.x[orb] = 15
    Position.y[orb] = 25

    projectileDeltaSystem(ctx)

    expect(ctx.homingOrbDeltas).toEqual([{ id: orb, x: 15, y: 25 }])
  })

  it("emits targetId null exactly once when a Homing Orb target is cleared", () => {
    const world = createWorld()
    const orb = addHomingOrb(world)
    const ctx = emptyCtx({
      world,
      prevHomingOrbStates: new Map([
        [orb, { x: 10, y: 20, vx: 30, vy: 40, headingRad: 0.5, targetId: "target" }],
      ]),
      homingOrbTargetPlayerMap: new Map(),
    })

    projectileDeltaSystem(ctx)
    projectileDeltaSystem(ctx)

    expect(ctx.homingOrbDeltas).toEqual([{ id: orb, targetId: null }])
  })

  it("emits changed Homing Orb velocity, heading, and target fields", () => {
    const world = createWorld()
    const orb = addHomingOrb(world)
    const ctx = emptyCtx({
      world,
      prevHomingOrbStates: new Map([
        [orb, { x: 10, y: 20, vx: 30, vy: 40, headingRad: 0.5 }],
      ]),
      homingOrbTargetPlayerMap: new Map([[orb, "target"]]),
    })
    Velocity.vx[orb] = 35
    Velocity.vy[orb] = 45
    HomingOrb.headingRad[orb] = 0.75

    projectileDeltaSystem(ctx)

    expect(ctx.homingOrbDeltas).toEqual([
      { id: orb, vx: 35, vy: 45, headingRad: 0.75, targetId: "target" },
    ])
  })
})
