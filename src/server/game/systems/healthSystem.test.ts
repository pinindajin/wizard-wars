import { addComponent, addEntity, createWorld } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  Health,
  Hero,
  JumpArc,
  PlayerTag,
  Position,
  TerrainState,
  TERRAIN_KIND,
} from "../components"
import { createCommandBuffer } from "../commandBuffer"
import type { SimCtx } from "../simulation"
import { ARENA_CLIFF_COLLIDERS, ARENA_LAVA_COLLIDERS } from "../../../shared/balance-config/arena"
import {
  DEFAULT_PLAYER_HEALTH,
  JUMP_AIRBORNE_COLLIDER_EPSILON_PX,
} from "../../../shared/balance-config/combat"
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
    homingOrbOwnerMap: new Map(),
    homingOrbTargetPlayerMap: new Map(),
    homingOrbCastTargetPlayerMap: new Map(),
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

  it("reclassifies lava terrain when knockback cancels an airborne jump", () => {
    const world = createWorld()
    const eid = addEntity(world)
    const lava = ARENA_LAVA_COLLIDERS[1]!
    for (const component of [PlayerTag, Position, Health, Hero, JumpArc, TerrainState]) {
      addComponent(world, eid, component)
    }
    Position.x[eid] = lava.x + lava.width / 2
    Position.y[eid] = lava.y + lava.height / 2
    Health.current[eid] = DEFAULT_PLAYER_HEALTH
    Health.max[eid] = DEFAULT_PLAYER_HEALTH
    Hero.typeIndex[eid] = 0
    JumpArc.z[eid] = JUMP_AIRBORNE_COLLIDER_EPSILON_PX + 1
    TerrainState.kind[eid] = TERRAIN_KIND.land

    healthSystem(emptyCtx({
      world,
      damageRequests: [{
        targetEid: eid,
        damage: 1,
        killerUserId: "caster",
        killerAbilityId: "fireball",
        knockbackX: 1,
        knockbackY: 0,
        knockbackPx: 20,
      }],
    }))

    expect(TerrainState.kind[eid]).toBe(TERRAIN_KIND.lava)
  })

  it("has no native cliff terrain to reclassify after knockback", () => {
    expect(ARENA_CLIFF_COLLIDERS).toEqual([])
  })
})
