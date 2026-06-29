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
  AbilityRuntime,
  Equipment,
  AbilitySlots,
  QuickItemSlots,
  PlayerInput,
  PlayerTag,
  InvulnerableTag,
  NeedsWorldCollisionResolution,
  HERO_INDEX,
  ABILITY_INDEX,
  FireballTag,
  HomingOrb,
  HomingOrbTag,
  JumpArc,
  SwingingWeapon,
  TerrainState,
  TERRAIN_KIND_TO_STATE,
} from "./components"
import { createCommandBuffer, CommandBuffer } from "./commandBuffer"
import type { PlayerInputQueueMap } from "./playerInputQueue"
import {
  ARENA_SPAWN_POINTS,
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  DEFAULT_PLAYER_HEALTH,
  STARTING_LIVES,
  STARTING_GOLD,
  PLAYER_RADIUS_PX,
  JUMP_MAX_CHARGES,
  HOMING_ORB_MAX_CHARGES,
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
  HomingOrbBatchUpdatePayload,
  HomingOrbImpactPayload,
  HomingOrbLaunchPayload,
  HomingOrbSnapshot,
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
  AbilityRuntimeStates,
  PlayerOwnerAckPayload,
} from "../../shared/types"
import {
  rebuildDamageablePlayerTargets,
  resetDamageablePlayerTargetCaches,
  type DamageablePlayerTarget,
  type HomingOrbDamageableTarget,
} from "./damageablePlayerCache"

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
import { abilityRuntimeStatesForPlayer } from "./abilityRuntimeState"
import { TICK_MS } from "../../shared/balance-config/rendering"

export const HELD_INPUT_STALE_MS = 250
export const HELD_INPUT_STALE_TICKS = Math.ceil(HELD_INPUT_STALE_MS / TICK_MS)

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
  jumpStartedInLava: boolean
  hasSwiftBoots: boolean
  terrainState: PlayerTerrainState
  abilityStates: AbilityRuntimeStates
  lastProcessedInputSeq: number
}

/** Snapshot of a fireball's position used to compute deltas each tick. */
export type FireballPrevState = {
  x: number
  y: number
}

/** Snapshot of a Homing Orb's movement state used to compute deltas each tick. */
export type HomingOrbPrevState = {
  x: number
  y: number
  vx: number
  vy: number
  headingRad: number
  targetId?: string
}

/** Mutable Homing Orb delta row accumulated inside one simulation tick. */
export type HomingOrbDelta = HomingOrbBatchUpdatePayload["deltas"][number]

/** Latest received weapon cursor for latency-sensitive swing facing snapshots. */
export type FreshestWeaponAim = {
  weaponTargetX: number
  weaponTargetY: number
}

type CoalescedHeldInput = {
  readonly input: PlayerInputPayload
  readonly heldThroughSeq: number
}

/**
 * Returns true when two queued inputs describe the same held intent and can be
 * represented by one payload plus virtual one-sequence-per-tick ACK advancement.
 *
 * Edge-triggered actions are excluded so casts and quick items are never
 * replayed from a coalesced held input.
 */
function canCoalesceHeldInput(
  first: PlayerInputPayload,
  second: PlayerInputPayload,
): boolean {
  if (
    first.abilitySlot !== null ||
    second.abilitySlot !== null ||
    first.useQuickItemSlot !== null ||
    second.useQuickItemSlot !== null
  ) {
    return false
  }
  return (
    first.up === second.up &&
    first.down === second.down &&
    first.left === second.left &&
    first.right === second.right &&
    first.weaponPrimary === second.weaponPrimary &&
    first.weaponSecondary === second.weaponSecondary &&
    first.weaponTargetX === second.weaponTargetX &&
    first.weaponTargetY === second.weaponTargetY &&
    first.abilityTargetX === second.abilityTargetX &&
    first.abilityTargetY === second.abilityTargetY
  )
}

/**
 * Builds the held-input payload used for virtual ACK ticks.
 */
function heldInputForVirtualAck(
  input: PlayerInputPayload,
  seq: number,
  serverTimeMs: number,
): PlayerInputPayload {
  return {
    ...input,
    abilitySlot: null,
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: serverTimeMs,
  }
}

/**
 * Builds an input payload shape from currently retained held component state.
 *
 * @param eid - Player entity id.
 * @param seq - Sequence cursor to assign to the retained payload shape.
 * @param serverTimeMs - Current server wall-clock time.
 * @returns A held input payload, or null when no held button is active.
 */
function retainedHeldInputForVirtualAck(
  eid: number,
  seq: number,
  serverTimeMs: number,
): PlayerInputPayload | null {
  const hasHeldInput =
    PlayerInput.up[eid] === 1 ||
    PlayerInput.down[eid] === 1 ||
    PlayerInput.left[eid] === 1 ||
    PlayerInput.right[eid] === 1 ||
    PlayerInput.weaponPrimary[eid] === 1 ||
    PlayerInput.weaponSecondary[eid] === 1
  if (!hasHeldInput) return null
  return {
    up: PlayerInput.up[eid] === 1,
    down: PlayerInput.down[eid] === 1,
    left: PlayerInput.left[eid] === 1,
    right: PlayerInput.right[eid] === 1,
    abilitySlot: null,
    abilityTargetX: PlayerInput.abilityTargetX[eid],
    abilityTargetY: PlayerInput.abilityTargetY[eid],
    weaponPrimary: PlayerInput.weaponPrimary[eid] === 1,
    weaponSecondary: PlayerInput.weaponSecondary[eid] === 1,
    weaponTargetX: PlayerInput.weaponTargetX[eid],
    weaponTargetY: PlayerInput.weaponTargetY[eid],
    useQuickItemSlot: null,
    seq,
    clientSendTimeMs: serverTimeMs,
  }
}

/**
 * Clears retained input component state for reconnects and removals.
 *
 * @param eid - Player entity id.
 */
function clearRetainedPlayerInput(eid: number): void {
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
}

/**
 * Restores held component state that was suppressed for one ACK-only tick.
 *
 * @param eid - Player entity id.
 * @param input - Retained held input snapshot to restore for future ticks.
 */
function restoreRetainedPlayerInput(
  eid: number,
  input: PlayerInputPayload,
): void {
  PlayerInput.up[eid] = input.up ? 1 : 0
  PlayerInput.down[eid] = input.down ? 1 : 0
  PlayerInput.left[eid] = input.left ? 1 : 0
  PlayerInput.right[eid] = input.right ? 1 : 0
  PlayerInput.weaponPrimary[eid] = input.weaponPrimary ? 1 : 0
  PlayerInput.weaponSecondary[eid] = input.weaponSecondary ? 1 : 0
  PlayerInput.abilitySlot[eid] = -1
  PlayerInput.abilityTargetX[eid] = input.abilityTargetX
  PlayerInput.abilityTargetY[eid] = input.abilityTargetY
  PlayerInput.weaponTargetX[eid] = input.weaponTargetX
  PlayerInput.weaponTargetY[eid] = input.weaponTargetY
  PlayerInput.useQuickItemSlot[eid] = -1
  PlayerInput.seq[eid] = input.seq
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
  /** Homing Orb entity ID → owner userId. */
  homingOrbOwnerMap: Map<number, string>
  /** Homing Orb entity ID → locked target userId for stale entity-id protection. */
  homingOrbTargetPlayerMap: Map<number, string>
  /** Caster entity ID → accepted cast target userId until effect time. */
  homingOrbCastTargetPlayerMap: Map<number, string>

  inputMap: Map<string, PlayerInputPayload>
  /**
   * Tick-local retained inputs whose already-simulated command seqs are being
   * ACKed without applying one extra retained movement/action tick.
   */
  suppressedRetainedInputsByPlayer?: Map<string, PlayerInputPayload>
  /**
   * Freshest currently queued weapon aim per player. This lets primary melee
   * snapshot direction from the latest received cursor while movement, casts,
   * and ACKs continue to consume the FIFO input queue one payload per tick.
   */
  freshestWeaponAimByPlayer?: Map<string, FreshestWeaponAim>
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
  homingOrbLaunches: HomingOrbLaunchPayload[]
  homingOrbImpacts: HomingOrbImpactPayload[]
  homingOrbRemovedIds: number[]
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
  prevHomingOrbStates: Map<number, HomingOrbPrevState>
  killStats: Map<string, KillStats>
  /**
   * Active primary melee swings keyed by caster eid. Persists across ticks for
   * the swing's full duration; primaryMeleeAttackSystem reads/mutates this each
   * tick to gate damage application to the dangerous-frames window.
   */
  activeMeleeAttacks: Map<number, ActiveMeleeAttack>
  /** Active combat telegraphs keyed by telegraph id for reconnect/full sync. */
  activeCombatTelegraphs: Map<string, CombatTelegraphStartPayload>
  /** Respawn invulnerability expiry tick keyed by player eid for this simulation world. */
  invulnerableExpiresAtTickByEntity: Map<number, number>
  /** Tick-local cache of live player hitboxes used by combat systems. */
  damageablePlayerTargetCache?: DamageablePlayerTarget[]
  /** Tick-local mapped-player view of damageable targets used by Homing Orb systems. */
  homingOrbDamageableTargetCache?: HomingOrbDamageableTarget[]

  // ── Written by playerDeltaSystem and projectileDeltaSystem ──
  playerDeltas: PlayerDelta[]
  fireballDeltas: { id: number; x: number; y: number }[]
  homingOrbDeltas: HomingOrbDelta[]
}

// ─── SimOutput ────────────────────────────────────────────────────────────

/** The data produced by one simulation tick, consumed by the game room. */
export type SimOutput = {
  playerDeltas: PlayerDelta[]
  fireballDeltas: { id: number; x: number; y: number }[]
  fireballRemovedIds: number[]
  homingOrbDeltas: HomingOrbDelta[]
  homingOrbRemovedIds: number[]
  playerDeaths: PlayerDeathPayload[]
  playerRespawns: PlayerRespawnPayload[]
  fireballLaunches: FireballLaunchPayload[]
  fireballImpacts: FireballImpactPayload[]
  homingOrbLaunches: HomingOrbLaunchPayload[]
  homingOrbImpacts: HomingOrbImpactPayload[]
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

type SimScratch = {
  readonly inputMap: Map<string, PlayerInputPayload>
  readonly suppressedRetainedInputsByPlayer: Map<string, PlayerInputPayload>
  readonly freshestWeaponAimByPlayer: Map<string, FreshestWeaponAim>
  readonly damageRequests: DamageRequest[]
  readonly deathEvents: DeathEvent[]
  readonly pendingLightningBolts: PendingLightningBolt[]
  readonly playerDeaths: PlayerDeathPayload[]
  readonly playerRespawns: PlayerRespawnPayload[]
  readonly fireballLaunches: FireballLaunchPayload[]
  readonly fireballImpacts: FireballImpactPayload[]
  readonly fireballRemovedIds: number[]
  readonly homingOrbLaunches: HomingOrbLaunchPayload[]
  readonly homingOrbImpacts: HomingOrbImpactPayload[]
  readonly homingOrbRemovedIds: number[]
  readonly lightningBolts: LightningBoltPayload[]
  readonly primaryMeleeAttacks: PrimaryMeleeAttackPayload[]
  readonly combatTelegraphStarts: CombatTelegraphStartPayload[]
  readonly combatTelegraphEnds: CombatTelegraphEndPayload[]
  readonly damageFloats: DamageFloatPayload[]
  readonly goldUpdates: { userId: string; gold: number }[]
  readonly abilitySfxEvents: AbilitySfxPayload[]
  readonly playerDeltas: PlayerDelta[]
  readonly fireballDeltas: { id: number; x: number; y: number }[]
  readonly homingOrbDeltas: HomingOrbDelta[]
  readonly output: SimOutput
}

/**
 * Creates the reusable per-simulation tick scratch storage.
 *
 * @returns Mutable maps/arrays owned by one simulation instance.
 */
function createSimScratch(): SimScratch {
  const playerDeltas: PlayerDelta[] = []
  const fireballDeltas: { id: number; x: number; y: number }[] = []
  const fireballRemovedIds: number[] = []
  const homingOrbDeltas: HomingOrbDelta[] = []
  const homingOrbRemovedIds: number[] = []
  const playerDeaths: PlayerDeathPayload[] = []
  const playerRespawns: PlayerRespawnPayload[] = []
  const fireballLaunches: FireballLaunchPayload[] = []
  const fireballImpacts: FireballImpactPayload[] = []
  const homingOrbLaunches: HomingOrbLaunchPayload[] = []
  const homingOrbImpacts: HomingOrbImpactPayload[] = []
  const lightningBolts: LightningBoltPayload[] = []
  const primaryMeleeAttacks: PrimaryMeleeAttackPayload[] = []
  const combatTelegraphStarts: CombatTelegraphStartPayload[] = []
  const combatTelegraphEnds: CombatTelegraphEndPayload[] = []
  const damageFloats: DamageFloatPayload[] = []
  const goldUpdates: { userId: string; gold: number }[] = []
  const abilitySfxEvents: AbilitySfxPayload[] = []

  return {
    inputMap: new Map(),
    suppressedRetainedInputsByPlayer: new Map(),
    freshestWeaponAimByPlayer: new Map(),
    damageRequests: [],
    deathEvents: [],
    pendingLightningBolts: [],
    playerDeaths,
    playerRespawns,
    fireballLaunches,
    fireballImpacts,
    fireballRemovedIds,
    homingOrbLaunches,
    homingOrbImpacts,
    homingOrbRemovedIds,
    lightningBolts,
    primaryMeleeAttacks,
    combatTelegraphStarts,
    combatTelegraphEnds,
    damageFloats,
    goldUpdates,
    abilitySfxEvents,
    playerDeltas,
    fireballDeltas,
    homingOrbDeltas,
    output: {
      playerDeltas,
      fireballDeltas,
      fireballRemovedIds,
      homingOrbDeltas,
      homingOrbRemovedIds,
      playerDeaths,
      playerRespawns,
      fireballLaunches,
      fireballImpacts,
      homingOrbLaunches,
      homingOrbImpacts,
      lightningBolts,
      primaryMeleeAttacks,
      combatTelegraphStarts,
      combatTelegraphEnds,
      damageFloats,
      goldUpdates,
      abilitySfxEvents,
      matchEnded: null,
    },
  }
}

/**
 * Clears every tick-local scratch collection before a simulation step.
 *
 * @param scratch - Simulation-owned scratch storage.
 */
function resetScratchForTick(scratch: SimScratch): void {
  scratch.inputMap.clear()
  scratch.suppressedRetainedInputsByPlayer.clear()
  scratch.freshestWeaponAimByPlayer.clear()
  scratch.damageRequests.length = 0
  scratch.deathEvents.length = 0
  scratch.pendingLightningBolts.length = 0
  scratch.playerDeaths.length = 0
  scratch.playerRespawns.length = 0
  scratch.fireballLaunches.length = 0
  scratch.fireballImpacts.length = 0
  scratch.fireballRemovedIds.length = 0
  scratch.homingOrbLaunches.length = 0
  scratch.homingOrbImpacts.length = 0
  scratch.homingOrbRemovedIds.length = 0
  scratch.lightningBolts.length = 0
  scratch.primaryMeleeAttacks.length = 0
  scratch.combatTelegraphStarts.length = 0
  scratch.combatTelegraphEnds.length = 0
  scratch.damageFloats.length = 0
  scratch.goldUpdates.length = 0
  scratch.abilitySfxEvents.length = 0
  scratch.playerDeltas.length = 0
  scratch.fireballDeltas.length = 0
  scratch.homingOrbDeltas.length = 0
  scratch.output.matchEnded = null
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
   *
   * The returned `SimOutput` is scratch-owned by this simulation instance and
   * is invalid after the next `tick` call. Rooms must copy, broadcast, or
   * coalesce output before advancing the simulation again.
   */
  tick: (perPlayerInputs: PlayerInputQueueMap, serverTimeMs: number) => SimOutput
  /** Signal that the host has requested an immediate match end. */
  requestHostEnd: () => void
  /**
   * Builds a full player snapshot for `game_state_sync` including
   * `serverTimeMs` and per-player `lastProcessedInputSeq`.
   */
  buildGameStateSyncPayload: (serverTimeMs: number) => GameStateSyncPayload
  /**
   * Builds an owner-only authoritative ACK sample for local replay.
   */
  buildPlayerOwnerAckPayload: (
    eid: number,
    lastProcessedInputSeq: number,
    serverTimeMs: number,
  ) => PlayerOwnerAckPayload | null
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
  const homingOrbOwnerMap = new Map<number, string>()
  const homingOrbTargetPlayerMap = new Map<number, string>()
  const homingOrbCastTargetPlayerMap = new Map<number, string>()
  const commandBuffer = createCommandBuffer()
  const prevPlayerStates = new Map<number, PlayerPrevState>()
  const prevFireballStates = new Map<number, FireballPrevState>()
  const prevHomingOrbStates = new Map<number, HomingOrbPrevState>()
  const killStats = new Map<string, KillStats>()
  const lastProcessedInputSeqByPlayer = new Map<string, number>()
  const lastInputTickByPlayer = new Map<string, number>()
  const coalescedHeldInputByPlayer = new Map<string, CoalescedHeldInput>()
  const retainedHeldTicksByPlayer = new Map<string, number>()
  const activeMeleeAttacks = new Map<number, ActiveMeleeAttack>()
  const activeCombatTelegraphs = new Map<string, CombatTelegraphStartPayload>()
  const invulnerableExpiresAtTickByEntity = new Map<number, number>()

  let currentTick = 0
  let hostEndSignal = false
  const scratch = createSimScratch()
  const ctx: SimCtx = {
    world,
    currentTick,
    serverTimeMs: matchStartedAtMs,
    playerEntityMap,
    entityPlayerMap,
    playerUsernameMap,
    entityUsernameMap,
    playerHeroIdMap,
    fireballOwnerMap,
    fireballCreatedAtTickMap,
    homingOrbOwnerMap,
    homingOrbTargetPlayerMap,
    homingOrbCastTargetPlayerMap,
    inputMap: scratch.inputMap,
    suppressedRetainedInputsByPlayer: scratch.suppressedRetainedInputsByPlayer,
    freshestWeaponAimByPlayer: scratch.freshestWeaponAimByPlayer,
    lastProcessedInputSeqByPlayer,
    commandBuffer,
    matchStartedAtMs,
    damageRequests: scratch.damageRequests,
    deathEvents: scratch.deathEvents,
    pendingLightningBolts: scratch.pendingLightningBolts,
    playerDeaths: scratch.playerDeaths,
    playerRespawns: scratch.playerRespawns,
    fireballLaunches: scratch.fireballLaunches,
    fireballImpacts: scratch.fireballImpacts,
    fireballRemovedIds: scratch.fireballRemovedIds,
    homingOrbLaunches: scratch.homingOrbLaunches,
    homingOrbImpacts: scratch.homingOrbImpacts,
    homingOrbRemovedIds: scratch.homingOrbRemovedIds,
    lightningBolts: scratch.lightningBolts,
    primaryMeleeAttacks: scratch.primaryMeleeAttacks,
    combatTelegraphStarts: scratch.combatTelegraphStarts,
    combatTelegraphEnds: scratch.combatTelegraphEnds,
    damageFloats: scratch.damageFloats,
    goldUpdates: scratch.goldUpdates,
    abilitySfxEvents: scratch.abilitySfxEvents,
    matchEnded: null,
    hostEndSignal,
    prevPlayerStates,
    prevFireballStates,
    prevHomingOrbStates,
    killStats,
    activeMeleeAttacks,
    activeCombatTelegraphs,
    invulnerableExpiresAtTickByEntity,
    playerDeltas: scratch.playerDeltas,
    fireballDeltas: scratch.fireballDeltas,
    homingOrbDeltas: scratch.homingOrbDeltas,
  }

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
    addComponent(world, eid, AbilityRuntime)
    addComponent(world, eid, Equipment)
    addComponent(world, eid, AbilitySlots)
    addComponent(world, eid, QuickItemSlots)
    addComponent(world, eid, PlayerInput)
    addComponent(world, eid, TerrainState)
    addComponent(world, eid, NeedsWorldCollisionResolution)

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
    Cooldown.homingOrb[eid] = 0
    Cooldown.lightningBolt[eid] = 0
    Cooldown.primaryMelee[eid] = 0
    Cooldown.healingPotion[eid] = 0
    Cooldown.jump[eid] = 0
    AbilityRuntime.fireballCooldownEndsAtMs[eid] = 0
    AbilityRuntime.homingOrbCharges[eid] = HOMING_ORB_MAX_CHARGES
    AbilityRuntime.homingOrbRechargeReadyTick[eid] = 0
    AbilityRuntime.homingOrbRechargeEndsAtMs[eid] = 0
    AbilityRuntime.lightningBoltCooldownEndsAtMs[eid] = 0
    AbilityRuntime.healingPotionCooldownEndsAtMs[eid] = 0
    AbilityRuntime.jumpCharges[eid] = JUMP_MAX_CHARGES
    AbilityRuntime.jumpRechargeReadyTick[eid] = 0
    AbilityRuntime.jumpRechargeEndsAtMs[eid] = 0

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
    clearRetainedPlayerInput(eid)
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
      jumpStartedInLava: false,
      terrainState: "land",
      hasSwiftBoots: false,
      abilityStates: abilityRuntimeStatesForPlayer(eid, currentTick),
      lastProcessedInputSeq: -1,
    })
    // `-1`: no input processed yet; first client `seq: 0` is accepted in `tick`.
    lastProcessedInputSeqByPlayer.set(userId, -1)
    lastInputTickByPlayer.set(userId, currentTick)
    retainedHeldTicksByPlayer.delete(userId)

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
    lastInputTickByPlayer.delete(userId)
    coalescedHeldInputByPlayer.delete(userId)
    retainedHeldTicksByPlayer.delete(userId)
    activeMeleeAttacks.delete(eid)
    homingOrbCastTargetPlayerMap.delete(eid)
    invulnerableExpiresAtTickByEntity.delete(eid)
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
    lastInputTickByPlayer.set(userId, currentTick)
    coalescedHeldInputByPlayer.delete(userId)
    retainedHeldTicksByPlayer.delete(userId)
    const eid = playerEntityMap.get(userId)
    if (eid !== undefined) clearRetainedPlayerInput(eid)
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
      const jumpStartedInLava =
        hasComponent(world, eid, JumpArc) && JumpArc.startedInLava[eid] === 1
      const hasSwiftBoots = Equipment.hasSwiftBoots[eid] === 1
      const terrainState = TERRAIN_KIND_TO_STATE[TerrainState.kind[eid]] ?? "land"
      const abilityStates = abilityRuntimeStatesForPlayer(eid, currentTick)
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
        jumpStartedInLava,
        hasSwiftBoots,
        terrainState,
        abilityStates,
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

    const homingOrbs: HomingOrbSnapshot[] = []
    for (const orbEid of query(world, [HomingOrbTag])) {
      const ownerId = homingOrbOwnerMap.get(orbEid)
      if (ownerId === undefined) continue
      const targetId = homingOrbTargetPlayerMap.get(orbEid)
      homingOrbs.push({
        id: orbEid,
        ownerId,
        ...(targetId !== undefined ? { targetId } : {}),
        x: Position.x[orbEid],
        y: Position.y[orbEid],
        vx: Velocity.vx[orbEid],
        vy: Velocity.vy[orbEid],
        headingRad: HomingOrb.headingRad[orbEid],
        expiresAtServerTimeMs:
          serverTimeMs + Math.max(0, HomingOrb.expiresAtTick[orbEid] - currentTick) * TICK_MS,
      })
    }

    const activeTelegraphs = [...activeCombatTelegraphs.values()].filter(
      (telegraph) => telegraph.endsAtServerTimeMs > serverTimeMs,
    )

    return { players, fireballs, homingOrbs, activeTelegraphs, seq: 0, serverTimeMs }
  }

  /**
   * Builds a dedicated owner ACK from current authoritative ECS state.
   *
   * @param eid - Player entity id to sample.
   * @param lastProcessedInputSeq - ACK cursor that triggered this sample.
   * @param serverTimeMs - Server wall-clock time for the ACK.
   * @returns Owner ACK payload, or null when the entity is no longer player-owned.
   */
  function buildPlayerOwnerAckPayload(
    eid: number,
    lastProcessedInputSeq: number,
    serverTimeMs: number,
  ): PlayerOwnerAckPayload | null {
    const playerId = entityPlayerMap.get(eid)
    if (playerId === undefined) return null
    const jumpActive = hasComponent(world, eid, JumpArc)
    const terrainState = TERRAIN_KIND_TO_STATE[TerrainState.kind[eid]] ?? "land"
    return {
      id: eid,
      playerId,
      x: Position.x[eid],
      y: Position.y[eid],
      vx: Velocity.vx[eid],
      vy: Velocity.vy[eid],
      lastProcessedInputSeq: Math.max(0, lastProcessedInputSeq),
      serverTimeMs,
      replayContext: {
        moveState: computePlayerMoveState(world, eid),
        terrainState,
        castingAbilityId: getCastingAbilityId(world, eid),
        jumpZ: jumpActive ? JumpArc.z[eid] : 0,
        jumpStartedInLava: jumpActive && JumpArc.startedInLava[eid] === 1,
        isSwinging: hasComponent(world, eid, SwingingWeapon),
        hasSwiftBoots: Equipment.hasSwiftBoots[eid] === 1,
      },
    }
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
   * @param perPlayerInputs - Map of userId → owned `PlayerInputQueue`.
   *   Queues are **mutated**: consumed inputs advance the queue head.
   * @param serverTimeMs - Current wall-clock time in milliseconds.
   * @returns Aggregated output events for this tick.
   */
  function tick(
    perPlayerInputs: PlayerInputQueueMap,
    serverTimeMs: number,
  ): SimOutput {
    currentTick++
    resetScratchForTick(scratch)
    ctx.currentTick = currentTick
    ctx.serverTimeMs = serverTimeMs
    ctx.matchEnded = null
    ctx.hostEndSignal = hostEndSignal
    resetDamageablePlayerTargetCaches(ctx)

    const inputMap = scratch.inputMap
    const suppressedRetainedInputsByPlayer =
      scratch.suppressedRetainedInputsByPlayer
    const freshestWeaponAimByPlayer = scratch.freshestWeaponAimByPlayer
    for (const [userId, queue] of perPlayerInputs) {
      let lastSeq = lastProcessedInputSeqByPlayer.get(userId) ?? 0
      const coalescedHeld = coalescedHeldInputByPlayer.get(userId)
      const staleThroughSeq = Math.max(
        lastSeq,
        coalescedHeld?.heldThroughSeq ?? lastSeq,
      )
      queue.dropThroughSeq(staleThroughSeq)

      const retainedTicks = retainedHeldTicksByPlayer.get(userId) ?? 0
      if (retainedTicks > 0) {
        const eid = playerEntityMap.get(userId)
        const retainedInput =
          eid === undefined
            ? null
            : retainedHeldInputForVirtualAck(eid, lastSeq + 1, serverTimeMs)
        let skipped = 0
        while (retainedInput !== null && skipped < retainedTicks) {
          const candidate = queue.peek()
          if (
            candidate === undefined ||
            !canCoalesceHeldInput(retainedInput, candidate)
          ) {
            break
          }
          queue.consume()
          lastSeq = candidate.seq
          skipped += 1
        }
        if (skipped > 0) {
          const remainingRetainedTicks = retainedTicks - skipped
          lastProcessedInputSeqByPlayer.set(userId, lastSeq)
          if (remainingRetainedTicks > 0) {
            retainedHeldTicksByPlayer.set(userId, remainingRetainedTicks)
          } else {
            retainedHeldTicksByPlayer.delete(userId)
            if (retainedInput !== null && queue.peek() === undefined) {
              suppressedRetainedInputsByPlayer.set(
                userId,
                heldInputForVirtualAck(retainedInput, lastSeq, serverTimeMs),
              )
            }
          }
        }
        if (skipped === 0 && retainedInput === null) {
          retainedHeldTicksByPlayer.delete(userId)
        }
      }

      const freshest = queue.latest()
      const next = queue.peek()

      if (coalescedHeld && coalescedHeld.heldThroughSeq > lastSeq) {
        const virtualSeq = lastSeq + 1
        const input = heldInputForVirtualAck(
          coalescedHeld.input,
          virtualSeq,
          serverTimeMs,
        )
        inputMap.set(userId, input)
        const freshestAim = freshest ?? input
        freshestWeaponAimByPlayer.set(userId, {
          weaponTargetX: freshestAim.weaponTargetX,
          weaponTargetY: freshestAim.weaponTargetY,
        })
        lastProcessedInputSeqByPlayer.set(userId, virtualSeq)
        lastInputTickByPlayer.set(userId, currentTick)
        retainedHeldTicksByPlayer.delete(userId)
        if (virtualSeq >= coalescedHeld.heldThroughSeq) {
          coalescedHeldInputByPlayer.delete(userId)
        }
        continue
      }

      if (freshest !== undefined) {
        freshestWeaponAimByPlayer.set(userId, {
          weaponTargetX: freshest.weaponTargetX,
          weaponTargetY: freshest.weaponTargetY,
        })
      }
      if (next !== undefined) {
        inputMap.set(userId, next)
        queue.consume()
        lastProcessedInputSeqByPlayer.set(userId, next.seq)
        lastInputTickByPlayer.set(userId, currentTick)
        retainedHeldTicksByPlayer.delete(userId)
        let heldThroughSeq = next.seq
        queue.consumeWhile(
          (queued) => canCoalesceHeldInput(next, queued),
          (queued) => {
            heldThroughSeq = Math.max(heldThroughSeq, queued.seq)
          },
        )
        if (heldThroughSeq > next.seq) {
          coalescedHeldInputByPlayer.set(userId, {
            input: heldInputForVirtualAck(next, next.seq, serverTimeMs),
            heldThroughSeq,
          })
        }
      }
    }

    for (const userId of playerEntityMap.keys()) {
      if (inputMap.has(userId)) continue
      if (suppressedRetainedInputsByPlayer.has(userId)) continue
      const lastInputTick = lastInputTickByPlayer.get(userId) ?? currentTick
      if (currentTick - lastInputTick <= HELD_INPUT_STALE_TICKS) {
        const eid = playerEntityMap.get(userId)
        if (eid === undefined) continue
        const lastSeq = lastProcessedInputSeqByPlayer.get(userId) ?? -1
        const retainedInput = retainedHeldInputForVirtualAck(
          eid,
          Math.max(0, lastSeq + 1),
          serverTimeMs,
        )
        if (retainedInput === null) {
          retainedHeldTicksByPlayer.delete(userId)
          continue
        }
        retainedHeldTicksByPlayer.set(
          userId,
          (retainedHeldTicksByPlayer.get(userId) ?? 0) + 1,
        )
        continue
      }
      retainedHeldTicksByPlayer.delete(userId)
      inputMap.set(userId, {
        up: false,
        down: false,
        left: false,
        right: false,
        abilitySlot: null,
        abilityTargetX: 0,
        abilityTargetY: 0,
        weaponPrimary: false,
        weaponSecondary: false,
        weaponTargetX: 0,
        weaponTargetY: 0,
        useQuickItemSlot: null,
        seq: Math.max(0, lastProcessedInputSeqByPlayer.get(userId) ?? 0),
        clientSendTimeMs: serverTimeMs,
      })
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
    rebuildDamageablePlayerTargets(ctx)
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
    worldCollisionSystem(ctx)
    playerDeltaSystem(ctx)
    projectileDeltaSystem(ctx)

    for (const [userId, input] of suppressedRetainedInputsByPlayer) {
      const eid = playerEntityMap.get(userId)
      if (eid !== undefined) restoreRetainedPlayerInput(eid, input)
    }

    if (ctx.matchEnded) {
      hostEndSignal = false
    }
    scratch.output.matchEnded = ctx.matchEnded

    return scratch.output
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
    buildPlayerOwnerAckPayload,
    resetClientInputStream,
  }
}
