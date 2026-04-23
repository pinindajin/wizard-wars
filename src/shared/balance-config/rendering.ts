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

/**
 * Maximum velocity-based extrapolation beyond the newest snapshot in the
 * remote interpolation buffer (used when the buffer underflows).
 */
export const REMOTE_EXTRAPOLATION_CAP_MS = 120

/** Base tile size in pixels (also used for all asset sprites). */
export const BASE_TILE_SIZE_PX = 64

/** Y-sort depth offset: tilemap layer rendered behind everything at -1000. */
export const TILEMAP_DEPTH = -1000
