import { addComponent, addEntity, createWorld, hasComponent } from "bitecs"
import { describe, expect, it } from "vitest"

import {
  ARENA_SPAWN_POINTS,
  DEFAULT_PLAYER_HEALTH,
  INVULNERABLE_WINDOW_MS,
  TICK_MS,
} from "../../../shared/balance-config"
import {
  DeadTag,
  Facing,
  Health,
  InvulnerableTag,
  MoveFacing,
  PlayerTag,
  Position,
  RespawnTimer,
  TerrainState,
} from "../components"
import type { SimCtx } from "../simulation"
import { livesRespawnSystem } from "./livesRespawnSystem"

const INVULNERABLE_TICKS = Math.ceil(INVULNERABLE_WINDOW_MS / TICK_MS)

function ctxFor(
  world: ReturnType<typeof createWorld>,
  currentTick: number,
  invulnerableExpiresAtTickByEntity = new Map<number, number>(),
): SimCtx {
  return {
    world,
    currentTick,
    serverTimeMs: currentTick * TICK_MS,
    entityPlayerMap: new Map(),
    entityUsernameMap: new Map(),
    playerUsernameMap: new Map(),
    deathEvents: [],
    playerDeaths: [],
    playerRespawns: [],
    invulnerableExpiresAtTickByEntity,
  } as unknown as SimCtx
}

function addRespawningPlayer(world: ReturnType<typeof createWorld>): number {
  const eid = addEntity(world)
  addComponent(world, eid, PlayerTag)
  addComponent(world, eid, DeadTag)
  addComponent(world, eid, RespawnTimer)
  addComponent(world, eid, Position)
  addComponent(world, eid, Facing)
  addComponent(world, eid, MoveFacing)
  addComponent(world, eid, Health)
  addComponent(world, eid, TerrainState)

  Health.max[eid] = DEFAULT_PLAYER_HEALTH
  RespawnTimer.fireAtMs[eid] = 0
  RespawnTimer.spawnX[eid] = ARENA_SPAWN_POINTS[0]!.x
  RespawnTimer.spawnY[eid] = ARENA_SPAWN_POINTS[0]!.y
  RespawnTimer.facingAngle[eid] = 0
  return eid
}

describe("livesRespawnSystem invulnerability expiry", () => {
  it("records timed invulnerability in world-local state when a respawn timer fires", () => {
    const world = createWorld()
    const eid = addRespawningPlayer(world)
    const expiries = new Map<number, number>()
    const ctx = ctxFor(world, 7, expiries)

    livesRespawnSystem(ctx)

    expect(hasComponent(world, eid, DeadTag)).toBe(false)
    expect(hasComponent(world, eid, InvulnerableTag)).toBe(true)
    expect(expiries.get(eid)).toBe(7 + INVULNERABLE_TICKS)
    expect(ctx.playerRespawns).toHaveLength(1)
  })

  it("does not expire invulnerability in another world with the same entity id", () => {
    const firstWorld = createWorld()
    const firstEid = addRespawningPlayer(firstWorld)
    livesRespawnSystem(ctxFor(firstWorld, 0))
    expect(hasComponent(firstWorld, firstEid, InvulnerableTag)).toBe(true)

    const secondWorld = createWorld()
    const secondEid = addEntity(secondWorld)
    expect(secondEid).toBe(firstEid)
    addComponent(secondWorld, secondEid, PlayerTag)
    addComponent(secondWorld, secondEid, InvulnerableTag)
    const secondExpiries = new Map([[secondEid, INVULNERABLE_TICKS + 100]])

    livesRespawnSystem(ctxFor(secondWorld, INVULNERABLE_TICKS, secondExpiries))

    expect(hasComponent(secondWorld, secondEid, InvulnerableTag)).toBe(true)
    expect(secondExpiries.get(secondEid)).toBe(INVULNERABLE_TICKS + 100)
  })

  it("expires timed invulnerability from the current simulation map", () => {
    const world = createWorld()
    addEntity(world)
    addEntity(world)
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, InvulnerableTag)
    const expiries = new Map([[eid, 5]])

    livesRespawnSystem(ctxFor(world, 5, expiries))

    expect(hasComponent(world, eid, InvulnerableTag)).toBe(false)
    expect(expiries.has(eid)).toBe(false)
  })

  it("leaves tag-only invulnerability untouched", () => {
    const world = createWorld()
    for (let i = 0; i < 5; i++) addEntity(world)
    const eid = addEntity(world)
    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, InvulnerableTag)
    const expiries = new Map<number, number>()

    livesRespawnSystem(ctxFor(world, 10, expiries))

    expect(hasComponent(world, eid, InvulnerableTag)).toBe(true)
    expect(expiries.size).toBe(0)
  })
})
