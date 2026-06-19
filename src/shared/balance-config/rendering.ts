import type { GameNetTimingPayload } from "@/shared/types"

/** Server simulation tick rate in Hz. */
export const TICK_RATE_HZ = 60
/** Duration of one simulation tick in seconds. */
export const TICK_DT_SEC = 1 / TICK_RATE_HZ
/** Duration of one simulation tick in milliseconds. */
export const TICK_MS = 1000 / TICK_RATE_HZ

/** Nominal interpolation window between authoritative player batches. */
export const INTERPOLATION_WINDOW_MS = TICK_MS
/** Distance threshold above which the client teleports instead of interpolating. */
export const TELEPORT_THRESHOLD_PX = 200
/** Prediction errors above this distance snap back to the authoritative path. */
export const PREDICTION_SNAP_THRESHOLD_PX = 32

/**
 * Below this prediction error the client applies the replay result silently
 * (no visible drag toward authority). Tune up if you see jitter, down if you
 * see cumulative drift.
 */
export const INVISIBLE_PREDICTION_ERROR_PX = 2

/**
 * Medium-error correction blends from the predicted position toward the
 * replayed-authoritative position across this many ms.
 */
export const REPLAY_SMOOTHING_MS = 80

/**
 * Remote players are rendered at `now - REMOTE_RENDER_DELAY_MS` so the
 * interpolation buffer always has at least one snapshot behind the render
 * time. Roughly two ticks at 60 Hz.
 */
export const REMOTE_RENDER_DELAY_MS = 33

/** Default server visual message cadence when no timing payload is available. */
export const DEFAULT_VISUAL_NET_SEND_RATE_HZ = 30
/** Minimum dynamic remote render delay, roughly three fixed sim ticks. */
export const REMOTE_RENDER_DELAY_MIN_MS = Math.ceil(3 * TICK_MS)
/** Maximum dynamic remote render delay before remote actors feel too stale. */
export const REMOTE_RENDER_DELAY_MAX_MS = 250

/**
 * Maximum velocity-based extrapolation beyond the newest snapshot in the
 * remote interpolation buffer (used when the buffer underflows).
 */
export const REMOTE_EXTRAPOLATION_CAP_MS = 120

/**
 * Computes the dynamic remote interpolation delay from the visual send interval.
 *
 * @param netSendIntervalMs - Server visual-message interval in milliseconds.
 * @returns Clamped render delay in milliseconds.
 */
export function resolveRemoteRenderDelayMs(netSendIntervalMs: number): number {
  const fallbackIntervalMs = 1000 / DEFAULT_VISUAL_NET_SEND_RATE_HZ
  const safeIntervalMs = isPositiveFiniteNumber(netSendIntervalMs)
    ? netSendIntervalMs
    : fallbackIntervalMs
  const delayMs = Math.ceil(2 * safeIntervalMs + TICK_MS)
  return clamp(delayMs, REMOTE_RENDER_DELAY_MIN_MS, REMOTE_RENDER_DELAY_MAX_MS)
}

/**
 * Normalizes optional server net timing into a complete interpolation contract.
 *
 * @param timing - Partial or missing server timing payload.
 * @returns Complete timing payload with a recomputed remote render delay.
 */
export function resolveGameNetTiming(
  timing?: Partial<GameNetTimingPayload> | null,
): GameNetTimingPayload {
  const providedIntervalMs = isPositiveFiniteNumber(timing?.netSendIntervalMs)
    ? timing.netSendIntervalMs
    : null
  const providedRateHz = isPositiveFiniteNumber(timing?.netSendRateHz)
    ? timing.netSendRateHz
    : null
  const netSendIntervalMs =
    providedIntervalMs ?? 1000 / (providedRateHz ?? DEFAULT_VISUAL_NET_SEND_RATE_HZ)
  const netSendRateHz = providedRateHz ?? 1000 / netSendIntervalMs
  return {
    protocolVersion: 1,
    tickRateHz: TICK_RATE_HZ,
    tickMs: TICK_MS,
    netSendRateHz,
    netSendIntervalMs,
    remoteRenderDelayMs: resolveRemoteRenderDelayMs(netSendIntervalMs),
  }
}

/**
 * Checks whether a value is a positive finite number.
 *
 * @param value - Number candidate.
 * @returns True when the value can safely drive timing math.
 */
function isPositiveFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}

/**
 * Clamps a number to an inclusive range.
 *
 * @param value - Candidate value.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @returns Value inside the provided range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Base tile size in pixels (also used for all asset sprites). */
export const BASE_TILE_SIZE_PX = 64

/** Y-sort depth offset: arena base visual rendered behind everything at -1000. */
export const TILEMAP_DEPTH = -1000

/**
 * Main camera zoom in the Arena. The Phaser canvas defaults to 1344×768
 * (`src/game/config.ts`) while the playable world is `ARENA_WIDTH`×`ARENA_HEIGHT`
 * (see `arena-layout.ts` / `arena.ts`). Zoom > 1 shrinks the visible world
 * slice so follow cameras have scroll headroom to keep the player centered.
 */
export const ARENA_CAMERA_FOLLOW_ZOOM = 1.2
