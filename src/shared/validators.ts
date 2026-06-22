import { z } from "zod"

import {
  ABILITY_BAR_SLOT_COUNT,
  QUICK_ITEM_SLOT_COUNT,
} from "./balance-config/economy"
import { MAX_PLAYERS_PER_MATCH } from "./balance-config/lobby"
import type {
  GameStateSyncPayload,
  PlayerInputStatePayload,
  PlayerDeathPayload,
  PlayerOwnerAckPayload,
  ServerPerformanceStatusPayload,
} from "./types"
import { PLAYER_INPUT_BUTTONS_MAX } from "./playerInputState"

/** Username: alphanumeric + underscore, 3-20 chars, must be trimmed before comparison. */
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/

const trimmedUsername = z
  .string()
  .trim()
  .regex(USERNAME_REGEX, "Username may only contain letters, numbers, and underscores")

/** Schema for login payloads and existing usernames (1-20 chars after trim). */
export const loginUsernameSchema = trimmedUsername.min(1).max(20)

/** Schema for new account signup (3-20 chars after trim, enforced in DB as case-insensitive unique). */
export const signupUsernameSchema = trimmedUsername
  .min(3, { message: "Username must be at least 3 characters." })
  .max(20, { message: "Username must be at most 20 characters." })

/** Schema for chat messages from the global /home room. */
export const chatMessagePayloadSchema = z.object({
  text: z.string().trim().min(1).max(200),
})

/** Schema for lobby chat messages. */
export const lobbyChatPayloadSchema = z.object({
  text: z.string().trim().min(1).max(200),
})

/** Schema for hero selection. */
export const heroSelectPayloadSchema = z.object({
  heroId: z.enum(["red_wizard", "barbarian", "ranger"]),
})

/** Schema for player input per tick. */
export const playerInputPayloadSchema = z.object({
  up: z.boolean(),
  down: z.boolean(),
  left: z.boolean(),
  right: z.boolean(),
  abilitySlot: z.number().int().min(0).max(ABILITY_BAR_SLOT_COUNT - 1).nullable(),
  abilityTargetX: z.number().finite(),
  abilityTargetY: z.number().finite(),
  weaponPrimary: z.boolean(),
  weaponSecondary: z.boolean(),
  weaponTargetX: z.number().finite(),
  weaponTargetY: z.number().finite(),
  useQuickItemSlot: z.number().int().min(0).max(QUICK_ITEM_SLOT_COUNT - 1).nullable(),
  seq: z.number().int().nonnegative(),
  clientSendTimeMs: z.number().finite().nonnegative(),
})

/** Schema for compact player input state. */
export const playerInputStatePayloadSchema = z.object({
  protocolVersion: z.literal(1),
  seq: z.number().int().nonnegative(),
  clientSendTimeMs: z.number().finite().nonnegative(),
  buttons: z.number().int().min(0).max(PLAYER_INPUT_BUTTONS_MAX),
  targetX: z.number().finite(),
  targetY: z.number().finite(),
  abilitySlot: z.number().int().min(0).max(ABILITY_BAR_SLOT_COUNT - 1).optional(),
  useQuickItemSlot: z.number().int().min(0).max(QUICK_ITEM_SLOT_COUNT - 1).optional(),
})

/** Schema for shop purchase. */
export const shopPurchasePayloadSchema = z.object({
  itemId: z.string().min(1).max(64),
})

/** Schema for ability slot assignment. */
export const assignAbilityPayloadSchema = z.object({
  itemId: z.string().min(1).max(64),
  slotIndex: z.number().int().min(0).max(ABILITY_BAR_SLOT_COUNT - 1),
})

/** Schema for use quick item. */
export const useQuickItemPayloadSchema = z.object({
  slotIndex: z.number().int().min(0).max(QUICK_ITEM_SLOT_COUNT - 1),
})

/** Schema for lobby player count (used in GET /api/lobbies). */
export const lobbyPlayerCountSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_PLAYERS_PER_MATCH)

/** `PlayerAnimState` values used in snapshots and batch updates. */
export const playerAnimStateSchema = z.enum([
  "idle",
  "walk",
  "dying",
  "light_cast",
  "heavy_cast",
  "primary_melee_attack",
  "jump",
  "stumble",
  "dead",
])

/** `PlayerMoveState` values used in snapshots and batch updates. */
export const playerMoveStateSchema = z.enum([
  "idle",
  "moving",
  "casting",
  "swinging",
  "knockback",
  "rooted",
])

export const playerTerrainStateSchema = z.enum(["land", "lava", "cliff"])

/** Server-authoritative HUD runtime state for one ability. */
export const abilityRuntimeStateSchema = z.object({
  cooldownEndsAtServerTimeMs: z.number().finite().nonnegative().nullable(),
  cooldownDurationMs: z.number().finite().nonnegative().nullable(),
  charges: z.number().int().nonnegative().nullable(),
  maxCharges: z.number().int().nonnegative().nullable(),
  rechargeEndsAtServerTimeMs: z.number().finite().nonnegative().nullable(),
  rechargeDurationMs: z.number().finite().nonnegative().nullable(),
})

/** Ability id keyed runtime state map for HUD rendering. */
export const abilityRuntimeStatesSchema = z.record(
  z.string().min(1).max(64),
  abilityRuntimeStateSchema,
)

/** Single player row in `GameStateSync`. */
export const playerSnapshotSchema = z.object({
  id: z.number().int().nonnegative(),
  playerId: z.string().min(1).max(256),
  username: z.string().max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  vx: z.number().finite(),
  vy: z.number().finite(),
  facingAngle: z.number().finite(),
  moveFacingAngle: z.number().finite(),
  health: z.number().finite(),
  maxHealth: z.number().finite(),
  lives: z.number().int().nonnegative(),
  heroId: z.string().min(1).max(64),
  animState: playerAnimStateSchema,
  moveState: playerMoveStateSchema,
  terrainState: playerTerrainStateSchema,
  castingAbilityId: z.string().min(1).max(64).nullable(),
  invulnerable: z.boolean(),
  jumpZ: z.number().finite().nonnegative(),
  jumpStartedInLava: z.boolean(),
  hasSwiftBoots: z.boolean().default(false),
  abilityStates: abilityRuntimeStatesSchema,
  lastProcessedInputSeq: z.number().int().nonnegative(),
})

/** Replay context carried only in owner ACK messages. */
export const playerOwnerAckReplayContextSchema = z.object({
  moveState: playerMoveStateSchema,
  terrainState: playerTerrainStateSchema,
  castingAbilityId: z.string().min(1).max(64).nullable(),
  jumpZ: z.number().finite().nonnegative(),
  jumpStartedInLava: z.boolean(),
  isSwinging: z.boolean(),
  hasSwiftBoots: z.boolean(),
})

/** Owner-only ACK payload for local rewind-and-replay reconciliation. */
export const playerOwnerAckPayloadSchema = z.object({
  id: z.number().int().nonnegative(),
  playerId: z.string().min(1).max(256),
  x: z.number().finite(),
  y: z.number().finite(),
  vx: z.number().finite(),
  vy: z.number().finite(),
  lastProcessedInputSeq: z.number().int().nonnegative(),
  serverTimeMs: z.number().finite().nonnegative(),
  replayContext: playerOwnerAckReplayContextSchema,
})

/** Max simultaneous fireballs included in a full sync (safety cap for Zod). */
const MAX_FIREBALLS_IN_SYNC = 128
/** Max simultaneous Homing Orbs included in a full sync (safety cap for Zod). */
const MAX_HOMING_ORBS_IN_SYNC = 128

/** Single fireball row in `GameStateSync`. */
export const fireballSnapshotSchema = z.object({
  id: z.number().int().nonnegative(),
  ownerId: z.string().min(1).max(256),
  x: z.number().finite(),
  y: z.number().finite(),
  vx: z.number().finite(),
  vy: z.number().finite(),
})

/** Single Homing Orb row in `GameStateSync`. */
export const homingOrbSnapshotSchema = z.object({
  id: z.number().int().nonnegative(),
  ownerId: z.string().min(1).max(256),
  targetId: z.string().min(1).max(256).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  vx: z.number().finite(),
  vy: z.number().finite(),
  headingRad: z.number().finite(),
  expiresAtServerTimeMs: z.number().finite().nonnegative(),
})

/** Server → clients: Homing Orb launch payload. */
export const homingOrbLaunchPayloadSchema = homingOrbSnapshotSchema

/** Single Homing Orb movement delta row. */
export const homingOrbDeltaSchema = z.object({
  id: z.number().int().nonnegative(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  vx: z.number().finite().optional(),
  vy: z.number().finite().optional(),
  headingRad: z.number().finite().optional(),
  targetId: z.string().min(1).max(256).nullable().optional(),
}).refine(
  (delta) =>
    delta.x !== undefined ||
    delta.y !== undefined ||
    delta.vx !== undefined ||
    delta.vy !== undefined ||
    delta.headingRad !== undefined ||
    delta.targetId !== undefined,
  { message: "Homing Orb delta must include at least one changed field" },
)

/** Server → clients: Homing Orb batch update payload. */
export const homingOrbBatchUpdatePayloadSchema = z.object({
  deltas: z.array(homingOrbDeltaSchema).max(MAX_HOMING_ORBS_IN_SYNC),
  removedIds: z.array(z.number().int().nonnegative()).max(MAX_HOMING_ORBS_IN_SYNC),
  seq: z.number().int().nonnegative(),
  serverTimeMs: z.number().finite().nonnegative().optional(),
})

/** Server → clients: Homing Orb hit or expiry impact payload. */
export const homingOrbImpactPayloadSchema = z.object({
  id: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  reason: z.enum(["hit", "expired"]),
  targetId: z.string().min(1).max(256).optional(),
  hitPlayerIds: z.array(z.string().min(1).max(256)).max(MAX_PLAYERS_PER_MATCH).optional(),
  damage: z.number().finite().nonnegative().optional(),
})

/** Shared combat telegraph shape schema. */
export const combatTelegraphShapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cone"),
    radiusPx: z.number().finite().positive(),
    arcDeg: z.number().finite().positive(),
  }),
  z.object({
    type: z.literal("capsule"),
    lengthPx: z.number().finite().positive(),
    radiusPx: z.number().finite().positive(),
  }),
])

/** Active combat telegraph row in `GameStateSync`. */
export const combatTelegraphStartPayloadSchema = z.object({
  id: z.string().min(1).max(512),
  casterId: z.string().min(1).max(256),
  sourceId: z.string().min(1).max(128),
  anchor: z.literal("caster"),
  directionRad: z.number().finite(),
  shape: combatTelegraphShapeSchema,
  startsAtServerTimeMs: z.number().finite().nonnegative(),
  dangerStartsAtServerTimeMs: z.number().finite().nonnegative(),
  dangerEndsAtServerTimeMs: z.number().finite().nonnegative(),
  endsAtServerTimeMs: z.number().finite().nonnegative(),
})

/** Net timing sent with match start/full sync to drive remote interpolation. */
export const gameNetTimingPayloadSchema = z.object({
  protocolVersion: z.literal(1),
  tickRateHz: z.number().finite().positive(),
  tickMs: z.number().finite().positive(),
  netSendRateHz: z.number().finite().positive(),
  netSendIntervalMs: z.number().finite().positive(),
  remoteRenderDelayMs: z.number().finite().positive(),
})

/** Input protocol advertised with match start/full sync. */
export const gameInputProtocolPayloadSchema = z.object({
  protocolVersion: z.literal(1),
  preferredTransport: z.enum(["legacy", "compact"]),
  activeHeartbeatMs: z.number().finite().positive(),
  idleHeartbeatMs: z.number().finite().positive(),
})

/** Full `game_state_sync` payload (server + client). */
export const gameStateSyncPayloadSchema = z.object({
  players: z.array(playerSnapshotSchema).max(MAX_PLAYERS_PER_MATCH),
  fireballs: z.array(fireballSnapshotSchema).max(MAX_FIREBALLS_IN_SYNC),
  homingOrbs: z.array(homingOrbSnapshotSchema).max(MAX_HOMING_ORBS_IN_SYNC).optional(),
  activeTelegraphs: z.array(combatTelegraphStartPayloadSchema).max(64).optional(),
  seq: z.number().int().nonnegative(),
  serverTimeMs: z.number().finite().nonnegative(),
  timing: gameNetTimingPayloadSchema.optional(),
  input: gameInputProtocolPayloadSchema.optional(),
})

/** Server → clients: player eliminated (validated before broadcast). */
export const playerDeathPayloadSchema = z.object({
  playerId: z.string().min(1).max(256),
  killerPlayerId: z.string().min(1).max(256).nullable(),
  killerAbilityId: z.string().min(1).max(64).nullable(),
  livesRemaining: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  victimUsername: z.string().max(64).optional(),
  killerUsername: z.string().max(64).optional(),
})

/** Server performance degradation reason values. */
export const serverPerformanceStatusReasonSchema = z.enum([
  "dropped_debt",
  "catch_up",
  "input_queue_drops",
  "event_loop_lag",
  "broadcast_slow",
])

/** Server → clients: low-rate server loop performance status. */
export const serverPerformanceStatusPayloadSchema = z.object({
  serverTimeMs: z.number().finite().nonnegative(),
  degraded: z.boolean(),
  reasons: z.array(serverPerformanceStatusReasonSchema).max(5),
  metrics: z.object({
    windowMs: z.number().finite().nonnegative(),
    droppedDebtMs: z.number().finite().nonnegative(),
    catchUpCallbacks: z.number().int().nonnegative(),
    inputQueueDrops: z.number().int().nonnegative(),
    simDurationMs: z.number().finite().nonnegative(),
    broadcastDurationMs: z.number().finite().nonnegative(),
    eventLoopLagMs: z.number().finite().nonnegative(),
    processCpuPercent: z.number().finite().nonnegative(),
    heapUsedBytes: z.number().int().nonnegative(),
    rssBytes: z.number().int().nonnegative(),
    activeRooms: z.number().int().nonnegative(),
    connectedClients: z.number().int().nonnegative(),
  }),
})

/**
 * Parses and returns a `PlayerDeathPayload` (throws if invalid).
 * Call on the server before every `broadcast` of this message.
 */
export function parsePlayerDeathPayload(
  input: Readonly<unknown> | PlayerDeathPayload,
): PlayerDeathPayload {
  return playerDeathPayloadSchema.parse(input) as PlayerDeathPayload
}

/**
 * Parses and returns a `GameStateSyncPayload` (throws if invalid).
 * Call on the server before every `broadcast` / `client.send` of this message.
 */
export function parseGameStateSyncPayload(
  input: Readonly<unknown> | GameStateSyncPayload,
): GameStateSyncPayload {
  return gameStateSyncPayloadSchema.parse(input) as GameStateSyncPayload
}

/**
 * Parses and returns a `PlayerOwnerAckPayload` (throws if invalid).
 *
 * @param input - Unknown owner ACK payload.
 * @returns Validated owner ACK payload.
 */
export function parsePlayerOwnerAckPayload(
  input: Readonly<unknown> | PlayerOwnerAckPayload,
): PlayerOwnerAckPayload {
  return playerOwnerAckPayloadSchema.parse(input) as PlayerOwnerAckPayload
}

/**
 * Parses and returns a compact `PlayerInputStatePayload`.
 *
 * @param input - Unknown compact input state payload.
 * @returns Validated compact input state payload.
 */
export function parsePlayerInputStatePayload(
  input: Readonly<unknown> | PlayerInputStatePayload,
): PlayerInputStatePayload {
  return playerInputStatePayloadSchema.parse(input) as PlayerInputStatePayload
}

/**
 * Parses and returns a `ServerPerformanceStatusPayload` (throws if invalid).
 *
 * @param input - Unknown payload received from the room.
 * @returns Validated server performance status payload.
 */
export function parseServerPerformanceStatusPayload(
  input: Readonly<unknown> | ServerPerformanceStatusPayload,
): ServerPerformanceStatusPayload {
  return serverPerformanceStatusPayloadSchema.parse(input) as ServerPerformanceStatusPayload
}
