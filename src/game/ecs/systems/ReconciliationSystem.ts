import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENA_WORLD_COLLIDERS,
  BASE_MOVE_SPEED_PX_PER_SEC,
  PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
  SWING_MOVE_SPEED_MULTIPLIER,
  SWIFT_BOOTS_SPEED_BONUS,
  TICK_DT_SEC,
} from "@/shared/balance-config"
import { ABILITY_CONFIGS } from "@/shared/balance-config/abilities"
import {
  INVISIBLE_PREDICTION_ERROR_PX,
  PREDICTION_SNAP_THRESHOLD_PX,
  REPLAY_SMOOTHING_MS,
} from "@/shared/balance-config/rendering"
import {
  normalizedMoveFromWASD,
  worldStepFromIntent,
} from "@/shared/movementIntent"
import { moveWithinWorld } from "@/shared/collision/worldCollision"
import type { PlayerInputPayload } from "@/shared/types"

import type { LocalInputHistory } from "../../network/LocalInputHistory"

/** Inputs that affect the player's per-tick move speed multiplier. */
export type LocalReplayContext = {
  /** Whether the local player currently has SwingingWeapon on the server. */
  readonly isSwinging: boolean
  /** Whether the local player has Swift Boots equipped. */
  readonly hasSwiftBoots: boolean
  /**
   * Server-reported active cast ability id, or `null` when not casting.
   * Used to look up the ability's `castMoveSpeedMultiplier`.
   */
  readonly castingAbilityId: string | null
}

/** Authoritative state the server just ACKed for the local player. */
export type LocalAckState = {
  readonly x: number
  readonly y: number
  readonly lastProcessedInputSeq: number
}

/** Result of `reconcile`. */
export type ReconcileResult = {
  /** Position the client should render now. */
  readonly renderX: number
  readonly renderY: number
  /**
   * Smoothing-target position (used when the client chooses to blend toward
   * the replayed position over `REPLAY_SMOOTHING_MS` instead of snapping).
   */
  readonly targetX: number
  readonly targetY: number
  /** Correction classification; drives the render path's smoothing choice. */
  readonly correction: "none" | "smooth" | "snap"
}

const ARENA_BOUNDS = { width: ARENA_WIDTH, height: ARENA_HEIGHT }
const PLAYER_WORLD_FOOTPRINT = {
  radiusX: PLAYER_WORLD_COLLISION_RADIUS_X_PX,
  radiusY: PLAYER_WORLD_COLLISION_RADIUS_Y_PX,
}

/**
 * Computes the per-tick speed multiplier used by local replay, mirroring
 * `movementSystem` on the server.
 */
function replaySpeedMultiplier(ctx: LocalReplayContext): number {
  let speedMultiplier = 1.0
  if (ctx.isSwinging) {
    speedMultiplier = SWING_MOVE_SPEED_MULTIPLIER
  } else if (ctx.hasSwiftBoots) {
    speedMultiplier = 1.0 + SWIFT_BOOTS_SPEED_BONUS
  }
  if (ctx.castingAbilityId) {
    const cfg = ABILITY_CONFIGS[ctx.castingAbilityId]
    const castMoveMult = cfg?.castMoveSpeedMultiplier ?? 0
    if (castMoveMult === 0) return 0
    speedMultiplier *= castMoveMult
  }
  return speedMultiplier
}

/**
 * Replays a single input step on top of `(x, y)`, applying the same
 * candidate-gated movement math the server uses. Returns the new `(x, y)`.
 */
function stepReplay(
  x: number,
  y: number,
  input: PlayerInputPayload,
  ctx: LocalReplayContext,
): { x: number; y: number } {
  const { dx, dy } = normalizedMoveFromWASD(input)
  if (dx === 0 && dy === 0) {
    return { x, y }
  }
  const mult = replaySpeedMultiplier(ctx)
  if (mult === 0) return { x, y }
  const step = worldStepFromIntent(
    dx,
    dy,
    BASE_MOVE_SPEED_PX_PER_SEC,
    TICK_DT_SEC,
    mult,
  )
  const moved = moveWithinWorld(
    x,
    y,
    step.x,
    step.y,
    PLAYER_WORLD_FOOTPRINT,
    ARENA_BOUNDS,
    ARENA_WORLD_COLLIDERS,
  )
  return { x: moved.x, y: moved.y }
}

/**
 * Classifies correction magnitude against configured thresholds:
 * - below `INVISIBLE_PREDICTION_ERROR_PX`: no visible correction needed.
 * - up to `PREDICTION_SNAP_THRESHOLD_PX`: smooth over `REPLAY_SMOOTHING_MS`.
 * - above `PREDICTION_SNAP_THRESHOLD_PX`: snap to replay result.
 */
function classifyCorrection(
  currentRenderX: number,
  currentRenderY: number,
  replayX: number,
  replayY: number,
): ReconcileResult["correction"] {
  const dx = replayX - currentRenderX
  const dy = replayY - currentRenderY
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist <= INVISIBLE_PREDICTION_ERROR_PX) return "none"
  if (dist > PREDICTION_SNAP_THRESHOLD_PX) return "snap"
  return "smooth"
}

/**
 * Runs one rewind-and-replay reconciliation pass for the local player.
 *
 * Given the server's ACKed authoritative state and the set of still-pending
 * client inputs (as known by {@link LocalInputHistory}), resets the local
 * predicted state to the ACKed position and replays each pending input
 * through shared movement + world-collision math. Compares the resulting
 * position to the currently rendered one and classifies the correction:
 * `"none"` (invisible), `"smooth"` (blend over `REPLAY_SMOOTHING_MS`), or
 * `"snap"` (immediate).
 *
 * @param ack - Authoritative state reported by the server.
 * @param history - Local input history; consumed inputs (`seq <= ack.seq`)
 *   are discarded.
 * @param currentRender - The position the player is currently rendered at.
 * @param ctx - Context that affects replay speed (casting / swinging / boots).
 * @returns Correction + the replay result for the render system to use.
 */
export function reconcileLocal(
  ack: LocalAckState,
  history: LocalInputHistory,
  currentRender: { x: number; y: number },
  ctx: LocalReplayContext,
): ReconcileResult {
  history.discardThrough(ack.lastProcessedInputSeq)

  let x = ack.x
  let y = ack.y
  for (const input of history.pending()) {
    const next = stepReplay(x, y, input, ctx)
    x = next.x
    y = next.y
  }

  const correction = classifyCorrection(currentRender.x, currentRender.y, x, y)

  // For "none" we return the current render as the frame output so the
  // rendered position literally does not change — zero visible correction.
  const renderX = correction === "none" ? currentRender.x : x
  const renderY = correction === "none" ? currentRender.y : y
  return { renderX, renderY, targetX: x, targetY: y, correction }
}

export const __test__ = { classifyCorrection, stepReplay, REPLAY_SMOOTHING_MS }
