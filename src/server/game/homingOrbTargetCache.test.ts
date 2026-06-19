import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  DeadTag,
  DyingTag,
  InvulnerableTag,
  PlayerTag,
  Position,
  SpectatorTag,
} from "./components"
import { createCommandBuffer } from "./commandBuffer"
import type { SimCtx } from "./simulation"
import { getHomingOrbDamageableTargets } from "./homingOrbTargetCache"

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

function addPlayer(
  ctx: SimCtx,
  userId: string,
  x: number,
  y: number,
  tag?: object,
): number {
  const eid = addEntity(ctx.world)
  addComponent(ctx.world, eid, PlayerTag)
  addComponent(ctx.world, eid, Position)
  if (tag) addComponent(ctx.world, eid, tag)
  Position.x[eid] = x
  Position.y[eid] = y
  ctx.entityPlayerMap.set(eid, userId)
  return eid
}

describe("Homing Orb damageable target cache", () => {
  it("builds damageable player hitboxes once per tick and filters inactive players", () => {
    const ctx = emptyCtx()
    const live = addPlayer(ctx, "live", 100, 100)
    addPlayer(ctx, "dead", 110, 100, DeadTag)
    addPlayer(ctx, "dying", 120, 100, DyingTag)
    addPlayer(ctx, "spectator", 130, 100, SpectatorTag)
    addPlayer(ctx, "invulnerable", 140, 100, InvulnerableTag)

    const first = getHomingOrbDamageableTargets(ctx)
    const second = getHomingOrbDamageableTargets(ctx)

    expect(second).toBe(first)
    expect(first).toEqual([
      expect.objectContaining({
        eid: live,
        userId: "live",
        hitbox: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      }),
    ])
  })
})
