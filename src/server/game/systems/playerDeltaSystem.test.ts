import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  AbilityRuntime,
  AbilitySlots,
  Casting,
  Cooldown,
  Equipment,
  Facing,
  Health,
  Hero,
  HERO_INDEX,
  JumpArc,
  Lives,
  MoveFacing,
  PlayerTag,
  Position,
  TerrainState,
  TERRAIN_KIND,
  Velocity,
} from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { PlayerPrevState, SimCtx } from "../simulation"
import { playerDeltaSystem } from "./playerDeltaSystem"

/**
 * Creates a minimal simulation context for player delta tests.
 *
 * @param overrides - Context fields to override.
 * @returns Simulation context.
 */
function emptyCtx(overrides: Partial<SimCtx> = {}): SimCtx {
  return {
    world: createWorld(),
    currentTick: 20,
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

/**
 * Adds one fully componentized player entity to the test world.
 *
 * @param ctx - Simulation context.
 * @param userId - User id mapped to the entity.
 * @returns Player entity id.
 */
function addPlayer(ctx: SimCtx, userId = "player-1"): number {
  const eid = addEntity(ctx.world)
  addComponent(ctx.world, eid, PlayerTag)
  addComponent(ctx.world, eid, Position)
  addComponent(ctx.world, eid, Velocity)
  addComponent(ctx.world, eid, Facing)
  addComponent(ctx.world, eid, MoveFacing)
  addComponent(ctx.world, eid, Health)
  addComponent(ctx.world, eid, Lives)
  addComponent(ctx.world, eid, Hero)
  addComponent(ctx.world, eid, Cooldown)
  addComponent(ctx.world, eid, AbilityRuntime)
  addComponent(ctx.world, eid, AbilitySlots)
  addComponent(ctx.world, eid, Equipment)
  addComponent(ctx.world, eid, TerrainState)

  Position.x[eid] = 100
  Position.y[eid] = 200
  Velocity.vx[eid] = 10
  Velocity.vy[eid] = 20
  Facing.angle[eid] = 0.25
  MoveFacing.angle[eid] = 0.5
  Health.current[eid] = 90
  Health.max[eid] = 100
  Lives.count[eid] = 3
  Hero.typeIndex[eid] = HERO_INDEX.red_wizard
  AbilityRuntime.jumpCharges[eid] = 4
  AbilityRuntime.homingOrbCharges[eid] = 2
  Equipment.primaryMeleeAttackIndex[eid] = 0
  TerrainState.kind[eid] = TERRAIN_KIND.land
  ctx.entityPlayerMap.set(eid, userId)
  ctx.lastProcessedInputSeqByPlayer.set(userId, 7)
  return eid
}

/**
 * Seeds the previous-state map by running one full delta tick.
 *
 * @param ctx - Simulation context.
 * @param eid - Player entity id.
 * @returns Seeded previous player state.
 */
function seedPrev(ctx: SimCtx, eid: number): PlayerPrevState {
  playerDeltaSystem(ctx)
  const prev = ctx.prevPlayerStates.get(eid)
  if (!prev) throw new Error("expected player prev state")
  ctx.playerDeltas.length = 0
  return prev
}

describe("playerDeltaSystem sparse delta contract", () => {
  it("seeds a new player with a full delta and emits no delta when unchanged", () => {
    const ctx = emptyCtx()
    const eid = addPlayer(ctx)

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([
      expect.objectContaining({
        id: eid,
        x: 100,
        y: 200,
        vx: 10,
        vy: 20,
        facingAngle: 0.25,
        moveFacingAngle: 0.5,
        health: 90,
        lives: 3,
        animState: "walk",
        moveState: "moving",
        castingAbilityId: null,
        invulnerable: false,
        jumpZ: 0,
        jumpStartedInLava: false,
        hasSwiftBoots: false,
        terrainState: "land",
        lastProcessedInputSeq: 7,
      }),
    ])

    ctx.playerDeltas.length = 0
    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([])
  })

  it("emits only changed sparse fields and preserves omitted fields as unchanged", () => {
    const ctx = emptyCtx()
    const eid = addPlayer(ctx)
    seedPrev(ctx, eid)

    Position.x[eid] = 110
    Velocity.vy[eid] = 35
    Health.current[eid] = 80

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([{ id: eid, x: 110, vy: 35, health: 80 }])
  })

  it("emits castingAbilityId null when a cast clears", () => {
    const ctx = emptyCtx()
    const eid = addPlayer(ctx)
    const prev = seedPrev(ctx, eid)
    prev.castingAbilityId = "fireball"

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([{ id: eid, castingAbilityId: null }])
  })

  it("omits lastProcessedInputSeq until the server has processed an input", () => {
    const ctx = emptyCtx()
    const eid = addPlayer(ctx)
    ctx.lastProcessedInputSeqByPlayer.set("player-1", -1)

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas[0]).not.toHaveProperty("lastProcessedInputSeq")

    ctx.playerDeltas.length = 0
    ctx.lastProcessedInputSeqByPlayer.set("player-1", 0)
    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([{ id: eid, lastProcessedInputSeq: 0 }])

    ctx.playerDeltas.length = 0
    ctx.lastProcessedInputSeqByPlayer.set("player-1", 1)
    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([{ id: eid, lastProcessedInputSeq: 1 }])
  })

  it("emits abilityStates only when runtime state changes", () => {
    const ctx = emptyCtx()
    const eid = addPlayer(ctx)
    seedPrev(ctx, eid)

    Cooldown.fireball[eid] = 40
    AbilityRuntime.fireballCooldownEndsAtMs[eid] = 2_000

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([
      {
        id: eid,
        abilityStates: expect.objectContaining({
          fireball: expect.objectContaining({
            cooldownEndsAtServerTimeMs: expect.any(Number),
          }),
        }),
      },
    ])
  })

  it("emits jumpStartedInLava when a lava jump starts", () => {
    const ctx = emptyCtx()
    const eid = addPlayer(ctx)
    seedPrev(ctx, eid)
    addComponent(ctx.world, eid, JumpArc)
    JumpArc.startedInLava[eid] = 1

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([
      expect.objectContaining({ id: eid, jumpStartedInLava: true }),
    ])
  })

  it("emits terrainState when the authoritative terrain changes", () => {
    const ctx = emptyCtx()
    const eid = addPlayer(ctx)
    seedPrev(ctx, eid)
    TerrainState.kind[eid] = TERRAIN_KIND.lava

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([{ id: eid, terrainState: "lava" }])
  })

  it("repeats facingAngle when a mouse-aim animation starts", () => {
    const ctx = emptyCtx()
    const eid = addPlayer(ctx)
    seedPrev(ctx, eid)
    addComponent(ctx.world, eid, Casting)

    playerDeltaSystem(ctx)

    expect(ctx.playerDeltas).toEqual([
      {
        id: eid,
        facingAngle: 0.25,
        animState: "light_cast",
        moveState: "casting",
        castingAbilityId: "fireball",
      },
    ])
  })
})
