/** Server simulation tick rate in Hz. */
export const TICK_RATE_HZ = 20
/** Duration of one simulation tick in seconds. */
export const TICK_DT_SEC = 1 / TICK_RATE_HZ
/** Duration of one simulation tick in milliseconds. */
export const TICK_MS = 1000 / TICK_RATE_HZ

/** Nominal interpolation window between authoritative player batches. */
export const INTERPOLATION_WINDOW_MS = TICK_MS
/** Distance threshold above which the client teleports instead of interpolating. */
export const TELEPORT_THRESHOLD_PX = 200
/** Prediction errors above this distance snap back to the authoritative path. */
export const PREDICTION_SNAP_THRESHOLD_PX = 64
/** Small blend back toward the authoritative path each predicted frame. */
export const PREDICTION_RECONCILE_ALPHA = 0.15

/** Base tile size in pixels (also used for all asset sprites). */
export const BASE_TILE_SIZE_PX = 64

/** Y-sort depth offset: tilemap layer rendered behind everything at -1000. */
export const TILEMAP_DEPTH = -1000
