import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import { Health, Hero, PlayerTag, Position } from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { SimCtx } from "../simulation"
import { DEFAULT_PLAYER_HEALTH } from "../../../shared/balance-config/combat"
import { healthSystem } from "./healthSystem"

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
    abilitySfxEvents: [],
    matchEnded: null,
    hostEndSignal: false,
    prevPlayerStates: new Map(),
    prevFireballStates: new Map(),
    killStats: new Map(),
    activeMeleeAttacks: new Map(),
    activeCombatTelegraphs: new Map(),
    playerDeltas: [],
    fireballDeltas: [],
    ...overrides,
  }
}

describe("healthSystem damage floats", () => {
  it("includes attackerUserId from killerUserId on DamageFloatPayload", () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    addComponent(world, eid, Health)
    addComponent(world, eid, Hero)
    Position.x[eid] = 10
    Position.y[eid] = 20
    Health.current[eid] = DEFAULT_PLAYER_HEALTH
    Health.max[eid] = DEFAULT_PLAYER_HEALTH
    Hero.typeIndex[eid] = 0

    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([[eid, "victim-user"]]),
      damageRequests: [
        {
          targetEid: eid,
          damage: 5,
          killerUserId: "killer-user",
          killerAbilityId: "axe",
        },
      ],
    })

    healthSystem(ctx)

    expect(ctx.damageFloats).toHaveLength(1)
    expect(ctx.damageFloats[0]!.targetId).toBe("victim-user")
    expect(ctx.damageFloats[0]!.attackerUserId).toBe("killer-user")
    expect(ctx.damageFloats[0]!.amount).toBe(5)
    expect(ctx.damageFloats[0]!.x).toBe(10)
    expect(ctx.damageFloats[0]!.y).toBe(20)
  })

  it("sets attackerUserId null when killerUserId is null", () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    addComponent(world, eid, Health)
    addComponent(world, eid, Hero)
    Position.x[eid] = 0
    Position.y[eid] = 0
    Health.current[eid] = DEFAULT_PLAYER_HEALTH
    Health.max[eid] = DEFAULT_PLAYER_HEALTH
    Hero.typeIndex[eid] = 0

    const ctx = emptyCtx({
      world,
      entityPlayerMap: new Map([[eid, "solo"]]),
      damageRequests: [
        {
          targetEid: eid,
          damage: 1,
          killerUserId: null,
          killerAbilityId: "lava",
        },
      ],
    })

    healthSystem(ctx)

    expect(ctx.damageFloats[0]!.attackerUserId).toBeNull()
  })
})
