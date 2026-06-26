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
import {
  getDamageablePlayerTargets,
  getHomingOrbDamageableTargets,
  rebuildDamageablePlayerTargets,
} from "./damageablePlayerCache"

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
  userId: string | undefined,
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
  if (userId !== undefined) ctx.entityPlayerMap.set(eid, userId)
  return eid
}

describe("damageable player target cache", () => {
  it("caches live vulnerable player hitboxes in query order, including unmapped players", () => {
    const ctx = emptyCtx()
    const first = addPlayer(ctx, "first", 100, 100)
    const unmapped = addPlayer(ctx, undefined, 110, 100)
    const second = addPlayer(ctx, "second", 120, 100)
    addPlayer(ctx, "dead", 130, 100, DeadTag)
    addPlayer(ctx, "dying", 140, 100, DyingTag)
    addPlayer(ctx, "spectator", 150, 100, SpectatorTag)
    addPlayer(ctx, "invulnerable", 160, 100, InvulnerableTag)

    const targets = getDamageablePlayerTargets(ctx)
    const sameTargets = getDamageablePlayerTargets(ctx)
    const homingTargets = getHomingOrbDamageableTargets(ctx)

    expect(sameTargets).toBe(targets)
    expect(targets.map((target) => [target.eid, target.userId])).toEqual([
      [first, "first"],
      [unmapped, undefined],
      [second, "second"],
    ])
    expect(targets[0]!.hitbox).toEqual(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    )
    expect(homingTargets.map((target) => [target.eid, target.userId])).toEqual([
      [first, "first"],
      [second, "second"],
    ])
  })

  it("rebuilds after player positions change and leaves the cached snapshot stable until rebuild", () => {
    const ctx = emptyCtx()
    const target = addPlayer(ctx, "target", 100, 100)
    const cached = getDamageablePlayerTargets(ctx)

    Position.x[target] = 220
    Position.y[target] = 240

    expect(getDamageablePlayerTargets(ctx)).toBe(cached)
    expect(cached[0]).toEqual(expect.objectContaining({ x: 100, y: 100 }))

    const rebuilt = rebuildDamageablePlayerTargets(ctx)

    expect(rebuilt).not.toBe(cached)
    expect(rebuilt[0]).toEqual(expect.objectContaining({ x: 220, y: 240 }))
  })
})
