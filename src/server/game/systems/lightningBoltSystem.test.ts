import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import { PlayerTag, Position } from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { SimCtx } from "../simulation"
import { lightningBoltSystem } from "./lightningBoltSystem"

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

function addPlayer(world: ReturnType<typeof createWorld>, x: number, y: number): number {
  const eid = addEntity(world)
  addComponent(world, eid, PlayerTag)
  addComponent(world, eid, Position)
  Position.x[eid] = x
  Position.y[eid] = y
  return eid
}

describe("lightningBoltSystem", () => {
  it("hits when the lightning capsule reaches the character hitbox", () => {
    const world = createWorld()
    const caster = addPlayer(world, 0, 0)
    const target = addPlayer(world, 100, 80)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([[target, "target"]]),
      pendingLightningBolts: [{ casterEid: caster, casterUserId: "caster", targetX: 200, targetY: 0 }],
    })

    lightningBoltSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(1)
    expect(ctx.damageRequests[0]!.targetEid).toBe(target)
    expect(ctx.lightningBolts[0]!.hitPlayerIds).toEqual(["target"])
  })

  it("misses when the lightning capsule does not reach the character hitbox", () => {
    const world = createWorld()
    const caster = addPlayer(world, 0, 0)
    const target = addPlayer(world, 100, 81)
    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([[target, "target"]]),
      pendingLightningBolts: [{ casterEid: caster, casterUserId: "caster", targetX: 200, targetY: 0 }],
    })

    lightningBoltSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
    expect(ctx.lightningBolts[0]!.hitPlayerIds).toEqual([])
  })

  it("excludes the caster from lightning hits", () => {
    const world = createWorld()
    const caster = addPlayer(world, 0, 0)
    const ctx = emptyCtx({
      world,
      pendingLightningBolts: [{ casterEid: caster, casterUserId: "caster", targetX: 200, targetY: 0 }],
    })

    lightningBoltSystem(ctx)

    expect(ctx.damageRequests).toHaveLength(0)
  })
})
