/**
 * Wizard Wars server-side game simulation.
 *
 * Owns the bitECS world, all entity maps, inter-system shared state, and runs
 * the full deterministic system pipeline on every 20 Hz tick.
 */
import { createWorld, addEntity, addComponent, removeEntity, query, hasComponent, World } from "bitecs"

import {
  Position,
  Velocity,
  Facing,
  Radius,
  Health,
  Lives,
  Gold,
  Hero,
  Cooldown,
  Equipment,
  AbilitySlots,
  QuickItemSlots,
  PlayerInput,
  PlayerTag,
  InvulnerableTag,
  HERO_INDEX,
  ABILITY_INDEX,
} from "./components"
import { createCommandBuffer, CommandBuffer } from "./commandBuffer"
import {
  ARENA_SPAWN_POINTS,
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  DEFAULT_PLAYER_HEALTH,
  STARTING_LIVES,
  STARTING_GOLD,
  PLAYER_RADIUS_PX,
} from "../../shared/balance-config"
import { DEFAULT_HERO_ID } from "../../shared/balance-config/heroes"
import type {
  PlayerInputPayload,
  PlayerDelta,
  FireballLaunchPayload,
  FireballImpactPayload,
  LightningBoltPayload,
  AxeSwingPayload,
  PlayerDeathPayload,
  PlayerRespawnPayload,
  DamageFloatPayload,
  ScoreboardEntry,
  GameStateSyncPayload,
  PlayerSnapshot,
  PlayerAnimState,
} from "../../shared/types"

import { inputSystem } from "./systems/inputSystem"
import { castingSystem } from "./systems/castingSystem"
import { movementSystem } from "./systems/movementSystem"
import { knockbackSystem } from "./systems/knockbackSystem"
import { playerCollisionSystem } from "./systems/playerCollisionSystem"
import { worldCollisionSystem } from "./systems/worldCollisionSystem"
import { projectileMovementSystem } from "./systems/projectileMovementSystem"
import { axeSwingSystem } from "./systems/axeSwingSystem"
import { lightningBoltSystem } from "./systems/lightningBoltSystem"
import { projectileCollisionSystem } from "./systems/projectileCollisionSystem"
import { healthSystem } from "./systems/healthSystem"
import { deathSystem } from "./systems/deathSystem"
import { livesRespawnSystem } from "./systems/livesRespawnSystem"
import { economySystem } from "./systems/economySystem"
import { matchEndSystem } from "./systems/matchEndSystem"
import { computePlayerAnimState } from "./playerAnimState"
import { playerDeltaSystem } from "./systems/playerDeltaSystem"
import { projectileDeltaSystem } from "./systems/projectileDeltaSystem"

// ─── Inter-system event types ─────────────────────────────────────────────

/**
 * Request for healthSystem to apply damage to a target entity.
 * Queued by projectileCollisionSystem, axeSwingSystem, and lightningBoltSystem.
 */
export type DamageRequest = {
  targetEid: number
  damage: number
  killerUserId: string | null
  killerAbilityId: string | null
  knockbackX?: number
  knockbackY?: number
  knockbackPx?: number
}

/** Internal death event produced by healthSystem, consumed by economySystem. */
export type DeathEvent = {
  playerEid: number
  userId: string
  killerUserId: string | null
  killerAbilityId: string | null
}

/** Lightning bolt cast queued by castingSystem for lightningBoltSystem. */
export type PendingLightningBolt = {
  casterEid: number
  casterUserId: string
  targetX: number
  targetY: number
}

/** Per-player statistics accumulated across the match for the scoreboard. */
export type KillStats = {
  kills: number
  deaths: number
  goldEarned: number
}

/** Snapshot of a player's state used to compute deltas each tick. */
export type PlayerPrevState = {
  x: number
  y: number
  facingAngle: number
  health: number
  lives: number
  animState: PlayerAnimState
  invulnerable: boolean
}

/** Snapshot of a fireball's position used to compute deltas each tick. */
export type FireballPrevState = {
  x: number
  y: number
}

// ─── SimCtx ───────────────────────────────────────────────────────────────

/**
 * Mutable simulation context passed to every system on every tick.
 *
 * Systems read from and append to the output arrays; the tick() function
 * assembles the final {@link SimOutput} from these at the end of the step.
 */
export type SimCtx = {
  world: World
  currentTick: number
  serverTimeMs: number

  // Entity ↔ userId maps
  playerEntityMap: Map<string, number>
  entityPlayerMap: Map<number, string>
  playerUsernameMap: Map<string, string>
  /** entity id → display username */
  entityUsernameMap: Map<number, string>
  playerHeroIdMap: Map<string, string>
  /** fireball entity ID → owner userId */
  fireballOwnerMap: Map<number, string>

  inputMap: Map<string, PlayerInputPayload>
  commandBuffer: CommandBuffer
  matchStartedAtMs: number

  // ── Inter-system event buses (reset each tick) ──
  damageRequests: DamageRequest[]
  deathEvents: DeathEvent[]
  pendingLightningBolts: PendingLightningBolt[]

  // ── Output accumulators (reset each tick) ──
  playerDeaths: PlayerDeathPayload[]
  playerRespawns: PlayerRespawnPayload[]
  fireballLaunches: FireballLaunchPayload[]
  fireballImpacts: FireballImpactPayload[]
  fireballRemovedIds: number[]
  lightningBolts: LightningBoltPayload[]
  axeSwings: AxeSwingPayload[]
  damageFloats: DamageFloatPayload[]
  goldUpdates: { userId: string; gold: number }[]

  // ── Match outcome ──
  matchEnded: SimOutput["matchEnded"]
  hostEndSignal: boolean

  // ── Cross-tick state ──
  prevPlayerStates: Map<number, PlayerPrevState>
  prevFireballStates: Map<number, FireballPrevState>
  killStats: Map<string, KillStats>

  // ── Written by playerDeltaSystem and projectileDeltaSystem ──
  playerDeltas: PlayerDelta[]
  fireballDeltas: { id: number; x: number; y: number }[]
}

// ─── SimOutput ────────────────────────────────────────────────────────────

/** The data produced by one simulation tick, consumed by the game room. */
export type SimOutput = {
  playerDeltas: PlayerDelta[]
  fireballDeltas: { id: number; x: number; y: number }[]
  fireballRemovedIds: number[]
  playerDeaths: PlayerDeathPayload[]
  playerRespawns: PlayerRespawnPayload[]
  fireballLaunches: FireballLaunchPayload[]
  fireballImpacts: FireballImpactPayload[]
  lightningBolts: LightningBoltPayload[]
  axeSwings: AxeSwingPayload[]
  damageFloats: DamageFloatPayload[]
  goldUpdates: { userId: string; gold: number }[]
  matchEnded: {
    reason: "lives_depleted" | "host_ended" | "time_cap"
    entries: ScoreboardEntry[]
  } | null
}

// ─── GameSimulation ───────────────────────────────────────────────────────

export type GameSimulation = {
  world: World
  playerEntityMap: Map<string, number>
  /** entity id → display username */
  entityUsernameMap: Map<number, string>
  matchStartedAtMs: number
  /** Adds a player entity and returns its entity ID. */
  addPlayer: (userId: string, username: string, heroId: string, spawnIndex: number) => number
  /** Removes a player entity from the simulation. Safe to call outside a tick. */
  removePlayer: (userId: string) => void
  /** Steps the simulation one tick forward. */
  tick: (inputMap: Map<string, PlayerInputPayload>, serverTimeMs: number) => SimOutput
  /** Signal that the host has requested an immediate match end. */
  requestHostEnd: () => void
  /**
   * Builds a full player snapshot for `game_state_sync` (authoritative, seq 0 in MVP).
   */
  buildGameStateSyncPayload: () => GameStateSyncPayload
}

// ─── Factory ─────────────────────────────────────────────────────────────

/**
 * Creates a fully-initialized GameSimulation.
 *
 * @param matchStartedAtMs - Wall-clock time (ms) when the match began.
 * @returns A GameSimulation ready for `addPlayer` / `tick` calls.
 */
export function createGameSimulation(matchStartedAtMs: number): GameSimulation {
  const world = createWorld()

  const playerEntityMap = new Map<string, number>()
  const entityPlayerMap = new Map<number, string>()
  const playerUsernameMap = new Map<string, string>()
  const entityUsernameMap = new Map<number, string>()
  const playerHeroIdMap = new Map<string, string>()
  const fireballOwnerMap = new Map<number, string>()
  const commandBuffer = createCommandBuffer()
  const prevPlayerStates = new Map<number, PlayerPrevState>()
  const prevFireballStates = new Map<number, FireballPrevState>()
  const killStats = new Map<string, KillStats>()

  let currentTick = 0
  let hostEndSignal = false

  // ── addPlayer ────────────────────────────────────────────────────────

  /**
   * Adds a player to the simulation at the given spawn index.
   *
   * @param userId     - Unique user identifier (JWT sub).
   * @param username   - Display name.
   * @param heroId     - Selected hero string ID.
   * @param spawnIndex - Index into ARENA_SPAWN_POINTS.
   * @returns The new entity ID.
   */
  function addPlayer(
    userId: string,
    username: string,
    heroId: string,
    spawnIndex: number,
  ): number {
    const eid = addEntity(world)
    const spawn = ARENA_SPAWN_POINTS[spawnIndex % ARENA_SPAWN_POINTS.length]
    const heroIndex = HERO_INDEX[heroId] ?? 0

    // Face toward arena center
    const dx = ARENA_CENTER_X - spawn.x
    const dy = ARENA_CENTER_Y - spawn.y
    const facingAngle = Math.atan2(dy, dx)

    addComponent(world, eid, PlayerTag)
    addComponent(world, eid, Position)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, Facing)
    addComponent(world, eid, Radius)
    addComponent(world, eid, Health)
    addComponent(world, eid, Lives)
    addComponent(world, eid, Gold)
    addComponent(world, eid, Hero)
    addComponent(world, eid, Cooldown)
    addComponent(world, eid, Equipment)
    addComponent(world, eid, AbilitySlots)
    addComponent(world, eid, QuickItemSlots)
    addComponent(world, eid, PlayerInput)

    Position.x[eid] = spawn.x
    Position.y[eid] = spawn.y
    Velocity.vx[eid] = 0
    Velocity.vy[eid] = 0
    Facing.angle[eid] = facingAngle
    Radius.r[eid] = PLAYER_RADIUS_PX
    Health.current[eid] = DEFAULT_PLAYER_HEALTH
    Health.max[eid] = DEFAULT_PLAYER_HEALTH
    Lives.count[eid] = STARTING_LIVES
    Gold.amount[eid] = STARTING_GOLD
    Hero.typeIndex[eid] = heroIndex

    Cooldown.fireball[eid] = 0
    Cooldown.lightningBolt[eid] = 0
    Cooldown.axe[eid] = 0
    Cooldown.healingPotion[eid] = 0

    Equipment.hasAxe[eid] = 0
    Equipment.hasSwiftBoots[eid] = 0

    // Slot 0 = fireball by default
    AbilitySlots.slot0[eid] = ABILITY_INDEX.fireball
    AbilitySlots.slot1[eid] = -1
    AbilitySlots.slot2[eid] = -1
    AbilitySlots.slot3[eid] = -1
    AbilitySlots.slot4[eid] = -1

    QuickItemSlots.slot0Item[eid] = -1
    QuickItemSlots.slot0Charges[eid] = 0
    QuickItemSlots.slot1Item[eid] = -1
    QuickItemSlots.slot1Charges[eid] = 0
    QuickItemSlots.slot2Item[eid] = -1
    QuickItemSlots.slot2Charges[eid] = 0
    QuickItemSlots.slot3Item[eid] = -1
    QuickItemSlots.slot3Charges[eid] = 0

    playerEntityMap.set(userId, eid)
    entityPlayerMap.set(eid, userId)
    playerUsernameMap.set(userId, username)
    entityUsernameMap.set(eid, username)
    playerHeroIdMap.set(userId, heroId)
    killStats.set(userId, { kills: 0, deaths: 0, goldEarned: STARTING_GOLD })

    prevPlayerStates.set(eid, {
      x: spawn.x,
      y: spawn.y,
      facingAngle,
      health: DEFAULT_PLAYER_HEALTH,
      lives: STARTING_LIVES,
      animState: "idle",
      invulnerable: false,
    })

    return eid
  }

  // ── removePlayer ─────────────────────────────────────────────────────

  /**
   * Removes a player entity from the simulation.
   * Should only be called outside the tick loop (e.g., on disconnect).
   *
   * @param userId - The player's userId to remove.
   */
  function removePlayer(userId: string): void {
    const eid = playerEntityMap.get(userId)
    if (eid === undefined) return
    removeEntity(world, eid)
    playerEntityMap.delete(userId)
    entityPlayerMap.delete(eid)
    playerUsernameMap.delete(userId)
    entityUsernameMap.delete(eid)
    playerHeroIdMap.delete(userId)
    prevPlayerStates.delete(eid)
  }

  // ── requestHostEnd ───────────────────────────────────────────────────

  /**
   * Signals that the host player has requested an early match end.
   * The signal is consumed by matchEndSystem on the next tick.
   */
  function requestHostEnd(): void {
    hostEndSignal = true
  }

  // ── buildGameStateSyncPayload ───────────────────────────────────────

  /**
   * Collects all live player entities into a `GameStateSyncPayload` (seq 0 for MVP).
   */
  function buildGameStateSyncPayload(): GameStateSyncPayload {
    const players: PlayerSnapshot[] = []
    for (const eid of query(world, [PlayerTag])) {
      const userId = entityPlayerMap.get(eid)
      if (userId === undefined) continue
      const username = entityUsernameMap.get(eid) ?? ""
      const heroId = playerHeroIdMap.get(userId) ?? DEFAULT_HERO_ID
      const x = Position.x[eid]
      const y = Position.y[eid]
      const facingAngle = Facing.angle[eid]
      const health = Health.current[eid]
      const maxHealth = Health.max[eid]
      const lives = Lives.count[eid]
      const animState = computePlayerAnimState(world, eid)
      const invulnerable = hasComponent(world, eid, InvulnerableTag)
      players.push({
        id: eid,
        playerId: userId,
        username,
        x,
        y,
        facingAngle,
        health,
        maxHealth,
        lives,
        heroId,
        animState,
        invulnerable,
      })
    }
    return { players, seq: 0 }
  }

  // ── tick ─────────────────────────────────────────────────────────────

  /**
   * Advances the simulation by one tick, running the full system pipeline.
   *
   * @param inputMap     - Map of userId → PlayerInputPayload for this tick.
   * @param serverTimeMs - Current wall-clock time in milliseconds.
   * @returns Aggregated output events for this tick.
   */
  function tick(
    inputMap: Map<string, PlayerInputPayload>,
    serverTimeMs: number,
  ): SimOutput {
    currentTick++

    const ctx: SimCtx = {
      world,
      currentTick,
      serverTimeMs,
      playerEntityMap,
      entityPlayerMap,
      playerUsernameMap,
      entityUsernameMap,
      playerHeroIdMap,
      fireballOwnerMap,
      inputMap,
      commandBuffer,
      matchStartedAtMs,
      damageRequests: [],
      deathEvents: [],
      pendingLightningBolts: [],
      playerDeaths: [],
      playerRespawns: [],
      fireballLaunches: [],
      fireballImpacts: [],
      fireballRemovedIds: [],
      lightningBolts: [],
      axeSwings: [],
      damageFloats: [],
      goldUpdates: [],
      matchEnded: null,
      hostEndSignal,
      prevPlayerStates,
      prevFireballStates,
      killStats,
      playerDeltas: [],
      fireballDeltas: [],
    }

    // ── System pipeline ──────────────────────────────────────────────
    inputSystem(ctx)
    castingSystem(ctx)
    movementSystem(ctx)
    knockbackSystem(ctx)
    playerCollisionSystem(ctx)
    worldCollisionSystem(ctx)
    projectileMovementSystem(ctx)
    axeSwingSystem(ctx)
    lightningBoltSystem(ctx)
    projectileCollisionSystem(ctx)
    healthSystem(ctx)
    deathSystem(ctx)
    livesRespawnSystem(ctx)
    economySystem(ctx)
    matchEndSystem(ctx)
    commandBuffer.execute(world)
    playerDeltaSystem(ctx)
    projectileDeltaSystem(ctx)

    if (ctx.matchEnded) {
      hostEndSignal = false
    }

    return {
      playerDeltas: ctx.playerDeltas,
      fireballDeltas: ctx.fireballDeltas,
      fireballRemovedIds: ctx.fireballRemovedIds,
      playerDeaths: ctx.playerDeaths,
      playerRespawns: ctx.playerRespawns,
      fireballLaunches: ctx.fireballLaunches,
      fireballImpacts: ctx.fireballImpacts,
      lightningBolts: ctx.lightningBolts,
      axeSwings: ctx.axeSwings,
      damageFloats: ctx.damageFloats,
      goldUpdates: ctx.goldUpdates,
      matchEnded: ctx.matchEnded,
    }
  }

  return {
    world,
    playerEntityMap,
    entityUsernameMap,
    matchStartedAtMs,
    addPlayer,
    removePlayer,
    tick,
    requestHostEnd,
    buildGameStateSyncPayload,
  }
}
