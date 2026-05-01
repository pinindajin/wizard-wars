/**
 * Wizard Wars server-side game simulation.
 *
 * Owns the bitECS world, all entity maps, inter-system shared state, and runs
 * the full deterministic system pipeline once per server tick (`TICK_MS` /
 * `TICK_RATE_HZ` in shared balance-config rendering).
 */
import { createWorld, addEntity, addComponent, removeEntity, query, hasComponent, World } from "bitecs"

import {
  Position,
  Velocity,
  Facing,
  MoveFacing,
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
  FireballTag,
  JumpArc,
  TerrainState,
  TERRAIN_KIND_TO_STATE,
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
import { DEFAULT_HERO_ID, getHeroPrimaryMeleeAttackId } from "../../shared/balance-config/heroes"
import {
  primaryMeleeAttackIdToIndex,
  type PrimaryMeleeAttackId,
} from "../../shared/balance-config/equipment"
import type {
  PlayerInputPayload,
  PlayerDelta,
  FireballLaunchPayload,
  FireballImpactPayload,
  LightningBoltPayload,
  PrimaryMeleeAttackPayload,
  PlayerDeathPayload,
  PlayerRespawnPayload,
  DamageFloatPayload,
  CombatTelegraphStartPayload,
  CombatTelegraphEndPayload,
  ScoreboardEntry,
  GameStateSyncPayload,
  PlayerSnapshot,
  PlayerAnimState,
  PlayerMoveState,
  PlayerTerrainState,
  FireballSnapshot,
  AbilitySfxPayload,
} from "../../shared/types"

import { inputSystem } from "./systems/inputSystem"
import { castingSystem } from "./systems/castingSystem"
import { movementSystem } from "./systems/movementSystem"
import { knockbackSystem } from "./systems/knockbackSystem"
import { playerCollisionSystem } from "./systems/playerCollisionSystem"
import { worldCollisionSystem } from "./systems/worldCollisionSystem"
import { jumpPhysicsSystem } from "./systems/jumpPhysicsSystem"
import { terrainHazardSystem } from "./systems/terrainHazardSystem"
import { projectileMovementSystem } from "./systems/projectileMovementSystem"
import { primaryMeleeAttackSystem } from "./systems/primaryMeleeAttackSystem"
import { lightningBoltSystem } from "./systems/lightningBoltSystem"
import { projectileCollisionSystem } from "./systems/projectileCollisionSystem"
import { healthSystem } from "./systems/healthSystem"
import { deathSystem } from "./systems/deathSystem"
import { livesRespawnSystem } from "./systems/livesRespawnSystem"
import { economySystem } from "./systems/economySystem"
import { matchEndSystem } from "./systems/matchEndSystem"
import { computePlayerAnimState, getCastingAbilityId } from "./playerAnimState"
import { computePlayerMoveState } from "./playerMoveState"
import { playerDeltaSystem } from "./systems/playerDeltaSystem"
import { projectileDeltaSystem } from "./systems/projectileDeltaSystem"

/**
 * Maps internal last-processed input seq to wire payloads (nonnegative int).
 * Internal `-1` means no input applied yet; emits `0`.
 *
 * @param m - The simulation's `lastProcessedInputSeqByPlayer` map.
 * @param userId - Affected user id.
 */
export function lastProcessedSeqForNetworkPayload(
  m: ReadonlyMap<string, number>,
  userId: string,
): number {
  return Math.max(0, m.get(userId) ?? 0)
}

// ─── Inter-system event types ─────────────────────────────────────────────

/**
 * Request for healthSystem to apply damage to a target entity.
 * Queued by projectileCollisionSystem, primaryMeleeAttackSystem, and lightningBoltSystem.
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
  directionRad: number
}

/**
 * Active primary melee swing tracked across ticks.
 *
 * Created on the input tick and removed once the swing duration elapses. The
 * `hitTargets` set guarantees single-hit-per-attack semantics during the
 * dangerous-frames window. Keyed by caster eid in {@link SimCtx.activeMeleeAttacks}
 * (cooldown enforces one active attack per caster).
 */
export type ActiveMeleeAttack = {
  attackId: PrimaryMeleeAttackId
  /** Tick on which the swing started (input tick). */
  startTick: number
  /** Facing angle in radians, locked at swing start. */
  facingAngle: number
  /** Caster userId at swing start (kept for damage attribution if entityPlayerMap drifts). */
  casterUserId: string
  /** Active telegraph id for the warning shown until the dangerous window ends. */
  telegraphId: string
  /** Target eids already damaged by this attack instance. */
  hitTargets: Set<number>
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
  vx: number
  vy: number
  facingAngle: number
  moveFacingAngle: number
  health: number
  lives: number
  animState: PlayerAnimState
  moveState: PlayerMoveState
  /** Mirrors server `getCastingAbilityId`; `null` when not casting. */
  castingAbilityId: string | null
  invulnerable: boolean
  jumpZ: number
  terrainState: PlayerTerrainState
  lastProcessedInputSeq: number
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
  /** fireball entity ID → simulation tick when launched */
  fireballCreatedAtTickMap: Map<number, number>

  inputMap: Map<string, PlayerInputPayload>
  /**
   * Highest client input `seq` this entity processed so far. Surfaced in
   * deltas + snapshots so the client can drive rewind-and-replay.
   */
  lastProcessedInputSeqByPlayer: Map<string, number>
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
  primaryMeleeAttacks: PrimaryMeleeAttackPayload[]
  combatTelegraphStarts: CombatTelegraphStartPayload[]
  combatTelegraphEnds: CombatTelegraphEndPayload[]
  damageFloats: DamageFloatPayload[]
  goldUpdates: { userId: string; gold: number }[]
  /** One-shot ability sounds to broadcast this tick (jump, etc.). */
  abilitySfxEvents: AbilitySfxPayload[]

  // ── Match outcome ──
  matchEnded: SimOutput["matchEnded"]
  hostEndSignal: boolean

  // ── Cross-tick state ──
  prevPlayerStates: Map<number, PlayerPrevState>
  prevFireballStates: Map<number, FireballPrevState>
  killStats: Map<string, KillStats>
  /**
   * Active primary melee swings keyed by caster eid. Persists across ticks for
   * the swing's full duration; primaryMeleeAttackSystem reads/mutates this each
   * tick to gate damage application to the dangerous-frames window.
   */
  activeMeleeAttacks: Map<number, ActiveMeleeAttack>
  /** Active combat telegraphs keyed by telegraph id for reconnect/full sync. */
  activeCombatTelegraphs: Map<string, CombatTelegraphStartPayload>

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
  primaryMeleeAttacks: PrimaryMeleeAttackPayload[]
  combatTelegraphStarts: CombatTelegraphStartPayload[]
  combatTelegraphEnds: CombatTelegraphEndPayload[]
  damageFloats: DamageFloatPayload[]
  goldUpdates: { userId: string; gold: number }[]
  abilitySfxEvents: AbilitySfxPayload[]
  matchEnded: {
    reason: "lives_depleted" | "host_ended" | "time_cap"
    entries: ScoreboardEntry[]
  } | null
}

// ─── GameSimulation ───────────────────────────────────────────────────────

export type GameSimulation = {
  world: World
  playerEntityMap: Map<string, number>
  /** entity id → user id (JWT sub); exposed for tests and diagnostics. */
  entityPlayerMap: Map<number, string>
  /** entity id → display username */
  entityUsernameMap: Map<number, string>
  matchStartedAtMs: number
  /** Adds a player entity and returns its entity ID. */
  addPlayer: (userId: string, username: string, heroId: string, spawnIndex: number) => number
  /** Removes a player entity from the simulation. Safe to call outside a tick. */
  removePlayer: (userId: string) => void
  /**
   * Steps the simulation one tick forward. Accepts an **ordered input queue**
   * per player; the first queued input (if any) is applied this tick and
   * `lastProcessedInputSeqByPlayer` is updated accordingly. Extra inputs in
   * the queue carry over to subsequent ticks, one per tick, preserving their
   * original `seq` ordering.
   */
  tick: (
    perPlayerInputs: Map<string, PlayerInputPayload[]>,
    serverTimeMs: number,
  ) => SimOutput
  /** Signal that the host has requested an immediate match end. */
  requestHostEnd: () => void
  /**
   * Builds a full player snapshot for `game_state_sync` including
   * `serverTimeMs` and per-player `lastProcessedInputSeq`.
   */
  buildGameStateSyncPayload: (serverTimeMs: number) => GameStateSyncPayload
  /**
   * Resets per-tick input ack state when a client establishes a new transport
   * (browser refresh) while the player entity still exists. Internal map may
   * hold `-1` until the first `seq: 0` is processed; see {@link lastProcessedSeqForNetworkPayload}.
   */
  resetClientInputStream: (userId: string) => void
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
  const fireballCreatedAtTickMap = new Map<number, number>()
  const commandBuffer = createCommandBuffer()
  const prevPlayerStates = new Map<number, PlayerPrevState>()
  const prevFireballStates = new Map<number, FireballPrevState>()
  const killStats = new Map<string, KillStats>()
  const lastProcessedInputSeqByPlayer = new Map<string, number>()
  const activeMeleeAttacks = new Map<number, ActiveMeleeAttack>()
  const activeCombatTelegraphs = new Map<string, CombatTelegraphStartPayload>()

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
    addComponent(world, eid, MoveFacing)
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
    addComponent(world, eid, TerrainState)

    Position.x[eid] = spawn.x
    Position.y[eid] = spawn.y
    Velocity.vx[eid] = 0
    Velocity.vy[eid] = 0
    Facing.angle[eid] = facingAngle
    MoveFacing.angle[eid] = facingAngle
    // Radius remains for player-player collision; world collision and combat use shared oval/rect helpers.
    Radius.r[eid] = PLAYER_RADIUS_PX
    Health.current[eid] = DEFAULT_PLAYER_HEALTH
    Health.max[eid] = DEFAULT_PLAYER_HEALTH
    Lives.count[eid] = STARTING_LIVES
    Gold.amount[eid] = STARTING_GOLD
    Hero.typeIndex[eid] = heroIndex

    Cooldown.fireball[eid] = 0
    Cooldown.lightningBolt[eid] = 0
    Cooldown.primaryMelee[eid] = 0
    Cooldown.healingPotion[eid] = 0
    Cooldown.jump[eid] = 0

    Equipment.primaryMeleeAttackIndex[eid] = primaryMeleeAttackIdToIndex(
      getHeroPrimaryMeleeAttackId(heroId),
    )
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

    // Zero-initialize PlayerInput explicitly. bitecs stores component
    // data in shared TypedArrays that persist across entity-id reuse and
    // across worlds, so we can't rely on "fresh entity = zero fields"
    // alone. Explicit zeroing matters because `inputSystem` now retains
    // held fields across empty-queue ticks (cause C fix) rather than
    // zeroing them every tick.
    PlayerInput.up[eid] = 0
    PlayerInput.down[eid] = 0
    PlayerInput.left[eid] = 0
    PlayerInput.right[eid] = 0
    PlayerInput.weaponPrimary[eid] = 0
    PlayerInput.weaponSecondary[eid] = 0
    PlayerInput.abilitySlot[eid] = -1
    PlayerInput.abilityTargetX[eid] = 0
    PlayerInput.abilityTargetY[eid] = 0
    PlayerInput.weaponTargetX[eid] = 0
    PlayerInput.weaponTargetY[eid] = 0
    PlayerInput.useQuickItemSlot[eid] = -1
    PlayerInput.seq[eid] = 0
    TerrainState.kind[eid] = 0
    TerrainState.lavaDamageCarry[eid] = 0

    playerEntityMap.set(userId, eid)
    entityPlayerMap.set(eid, userId)
    playerUsernameMap.set(userId, username)
    entityUsernameMap.set(eid, username)
    playerHeroIdMap.set(userId, heroId)
    killStats.set(userId, { kills: 0, deaths: 0, goldEarned: STARTING_GOLD })

    prevPlayerStates.set(eid, {
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      facingAngle,
      moveFacingAngle: facingAngle,
      health: DEFAULT_PLAYER_HEALTH,
      lives: STARTING_LIVES,
      animState: "idle",
      moveState: "idle",
      castingAbilityId: null,
      invulnerable: false,
      jumpZ: 0,
      terrainState: "land",
      lastProcessedInputSeq: 0,
    })
    // `-1`: no input processed yet; first client `seq: 0` is accepted in `tick`.
    lastProcessedInputSeqByPlayer.set(userId, -1)

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
    lastProcessedInputSeqByPlayer.delete(userId)
    activeMeleeAttacks.delete(eid)
    for (const [id, telegraph] of activeCombatTelegraphs) {
      if (telegraph.casterId === userId) activeCombatTelegraphs.delete(id)
    }
  }

  // ── requestHostEnd ───────────────────────────────────────────────────

  /**
   * Signals that the host player has requested an early match end.
   * The signal is consumed by matchEndSystem on the next tick.
   */
  function requestHostEnd(): void {
    hostEndSignal = true
  }

  /**
   * Clears reconnect-stale input ack state so a new `seq` stream (from 0) is accepted.
   *
   * @param userId - The player that reconnected; must be an in-world entity.
   */
  function resetClientInputStream(userId: string): void {
    lastProcessedInputSeqByPlayer.set(userId, -1)
  }

  // ── buildGameStateSyncPayload ───────────────────────────────────────

  /**
   * Collects all live player entities and active fireballs into a
   * `GameStateSyncPayload` enriched with `serverTimeMs`, per-player
   * velocity, move state, and `lastProcessedInputSeq`.
   *
   * @param serverTimeMs - Wall-clock time (ms) to embed in the payload.
   */
  function buildGameStateSyncPayload(serverTimeMs: number): GameStateSyncPayload {
    const players: PlayerSnapshot[] = []
    for (const eid of query(world, [PlayerTag])) {
      const userId = entityPlayerMap.get(eid)
      if (userId === undefined) continue
      const username = entityUsernameMap.get(eid) ?? ""
      const heroId = playerHeroIdMap.get(userId) ?? DEFAULT_HERO_ID
      const x = Position.x[eid]
      const y = Position.y[eid]
      const vx = Velocity.vx[eid]
      const vy = Velocity.vy[eid]
      const facingAngle = Facing.angle[eid]
      const moveFacingAngle = MoveFacing.angle[eid]
      const health = Health.current[eid]
      const maxHealth = Health.max[eid]
      const lives = Lives.count[eid]
      const animState = computePlayerAnimState(world, eid)
      const moveState = computePlayerMoveState(world, eid)
      const invulnerable = hasComponent(world, eid, InvulnerableTag)
      const castingAbilityId = getCastingAbilityId(world, eid)
      const jumpZ = hasComponent(world, eid, JumpArc) ? JumpArc.z[eid] : 0
      const terrainState = TERRAIN_KIND_TO_STATE[TerrainState.kind[eid]] ?? "land"
      const lastProcessedInputSeq = lastProcessedSeqForNetworkPayload(
        lastProcessedInputSeqByPlayer,
        userId,
      )
      players.push({
        id: eid,
        playerId: userId,
        username,
        x,
        y,
        vx,
        vy,
        facingAngle,
        moveFacingAngle,
        health,
        maxHealth,
        lives,
        heroId,
        animState,
        moveState,
        castingAbilityId,
        invulnerable,
        jumpZ,
        terrainState,
        lastProcessedInputSeq,
      })
    }

    const fireballs: FireballSnapshot[] = []
    for (const fbEid of query(world, [FireballTag])) {
      const ownerId = fireballOwnerMap.get(fbEid)
      if (ownerId === undefined) continue
      fireballs.push({
        id: fbEid,
        ownerId,
        x: Position.x[fbEid],
        y: Position.y[fbEid],
        vx: Velocity.vx[fbEid],
        vy: Velocity.vy[fbEid],
      })
    }

    const activeTelegraphs = [...activeCombatTelegraphs.values()].filter(
      (telegraph) => telegraph.endsAtServerTimeMs > serverTimeMs,
    )

    return { players, fireballs, activeTelegraphs, seq: 0, serverTimeMs }
  }

  // ── tick ─────────────────────────────────────────────────────────────

  /**
   * Advances the simulation by one tick.
   *
   * Takes the next queued input per player (in `seq` order) and applies it
   * through the system pipeline. Inputs with `seq <= lastProcessedInputSeq`
   * for that player are dropped. `lastProcessedInputSeqByPlayer` is advanced
   * to the highest consumed `seq`.
   *
   * @param perPlayerInputs - Map of userId → ordered `PlayerInputPayload[]`.
   *   The map is **mutated**: consumed inputs are shifted off the front.
   * @param serverTimeMs - Current wall-clock time in milliseconds.
   * @returns Aggregated output events for this tick.
   */
  function tick(
    perPlayerInputs: Map<string, PlayerInputPayload[]>,
    serverTimeMs: number,
  ): SimOutput {
    currentTick++

    const inputMap = new Map<string, PlayerInputPayload>()
    for (const [userId, queue] of perPlayerInputs) {
      const lastSeq = lastProcessedInputSeqByPlayer.get(userId) ?? 0
      // Drop already-processed inputs at the head of the queue.
      while (queue.length > 0 && queue[0].seq <= lastSeq) {
        queue.shift()
      }
      const next = queue[0]
      if (next !== undefined) {
        inputMap.set(userId, next)
        queue.shift()
        lastProcessedInputSeqByPlayer.set(userId, next.seq)
      }
    }

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
      fireballCreatedAtTickMap,
      inputMap,
      lastProcessedInputSeqByPlayer,
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
      primaryMeleeAttacks: [],
      combatTelegraphStarts: [],
      combatTelegraphEnds: [],
      damageFloats: [],
      goldUpdates: [],
      abilitySfxEvents: [],
      matchEnded: null,
      hostEndSignal,
      prevPlayerStates,
      prevFireballStates,
      killStats,
      activeMeleeAttacks,
      activeCombatTelegraphs,
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
    jumpPhysicsSystem(ctx)
    terrainHazardSystem(ctx)
    projectileMovementSystem(ctx)
    primaryMeleeAttackSystem(ctx)
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
      primaryMeleeAttacks: ctx.primaryMeleeAttacks,
      combatTelegraphStarts: ctx.combatTelegraphStarts,
      combatTelegraphEnds: ctx.combatTelegraphEnds,
      damageFloats: ctx.damageFloats,
      goldUpdates: ctx.goldUpdates,
      abilitySfxEvents: ctx.abilitySfxEvents,
      matchEnded: ctx.matchEnded,
    }
  }

  return {
    world,
    playerEntityMap,
    entityPlayerMap,
    entityUsernameMap,
    matchStartedAtMs,
    addPlayer,
    removePlayer,
    tick,
    requestHostEnd,
    buildGameStateSyncPayload,
    resetClientInputStream,
  }
}
